"""Build backend-owned UMAP projection data from persisted fraud-memory cases."""

from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

import numpy as np
from sklearn.decomposition import PCA
from sqlalchemy import text
from sqlalchemy.orm import selectinload

from app.db.models import Case
from app.db.session import SessionLocal
from app.schemas.case_umap import CaseUmapCurrentScan, CaseUmapPoint, CaseUmapProjection, CaseUmapResponse


PROJECTION_PIPELINE = "case_chunks.embedding mean -> PCA(<=50) -> UMAP(2)"
MIN_UMAP_CASES = 10


@dataclass(frozen=True)
class _CaseEmbedding:
    case: Case
    embedding: list[float]


def build_case_umap(limit: int = 500, scan_id: str | None = None, refresh: bool = False) -> CaseUmapResponse:
    """Return 2D case points with risk metadata for frontend UMAP visualization."""
    del refresh  # Projection is recomputed from DB state; kept for client cache-busting compatibility.
    case_embeddings = _load_case_embeddings(limit=limit)
    coordinates = _normalize_coordinates(_project_embeddings([item.embedding for item in case_embeddings]))

    points: list[CaseUmapPoint] = []
    for item, (x, y) in zip(case_embeddings, coordinates):
        risk_level, risk_score, variant = _risk_for_case(item.case)
        points.append(
            CaseUmapPoint(
                case_id=item.case.case_id,
                label=item.case.title or item.case.case_id,
                x=round(float(x), 6),
                y=round(float(y), 6),
                variant=variant,
                summary=item.case.summary,
                source_url=item.case.source_url,
                platform_hint=item.case.platform_hint,
                risk_level=risk_level,
                risk_score=risk_score,
                risk_flags=_coerce_flags(item.case.risk_flags_json),
            )
        )

    risk_counts = _ordered_variant_counts(point.variant for point in points)
    current_scan = _build_current_scan(scan_id=scan_id, points=points)

    return CaseUmapResponse(
        points=points,
        total_cases=len(case_embeddings),
        risk_counts=risk_counts,
        projection=CaseUmapProjection(
            pipeline=PROJECTION_PIPELINE,
            pca_components=_pca_component_count([item.embedding for item in case_embeddings]),
            umap_neighbors=_umap_neighbor_count(len(case_embeddings)),
            umap_min_dist=0.12 if len(case_embeddings) >= MIN_UMAP_CASES else None,
        ),
        current_scan=current_scan,
    )


def _load_case_embeddings(limit: int) -> list[_CaseEmbedding]:
    with SessionLocal() as db:
        cases = (
            db.query(Case)
            .options(selectinload(Case.chunks))
            .order_by(Case.created_at.desc(), Case.case_id.asc())
            .limit(limit)
            .all()
        )

        loaded: list[_CaseEmbedding] = []
        for case in cases:
            embeddings = [
                embedding
                for embedding in (_coerce_embedding(chunk.embedding) for chunk in case.chunks)
                if embedding
            ]
            mean_embedding = _mean_embedding(embeddings)
            if mean_embedding:
                loaded.append(_CaseEmbedding(case=case, embedding=mean_embedding))

        return loaded


def _coerce_embedding(value: object | None) -> list[float] | None:
    if value is None:
        return None

    if hasattr(value, "tolist"):
        value = value.tolist()

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = [part.strip() for part in value.strip("[]").split(",") if part.strip()]

    if not isinstance(value, Iterable):
        return None

    try:
        embedding = [float(item) for item in value]
    except (TypeError, ValueError):
        return None

    if not embedding or any(not math.isfinite(item) for item in embedding):
        return None

    return embedding


def _mean_embedding(embeddings: list[list[float]]) -> list[float] | None:
    if not embeddings:
        return None

    dimension = len(embeddings[0])
    aligned = [embedding for embedding in embeddings if len(embedding) == dimension]
    if not aligned:
        return None

    return np.asarray(aligned, dtype=float).mean(axis=0).tolist()


def _project_embeddings(embeddings: list[list[float]]) -> list[tuple[float, float]]:
    if not embeddings:
        return []

    if len(embeddings) == 1:
        return [(0.0, 0.0)]

    if len(embeddings) == 2:
        return [(-0.5, 0.0), (0.5, 0.0)]

    matrix = np.asarray(embeddings, dtype=float)
    pca_components = _pca_component_count(embeddings)
    pca_matrix = PCA(n_components=pca_components).fit_transform(matrix)

    if len(embeddings) < MIN_UMAP_CASES:
        projected = _fallback_projection(pca_matrix)
        return [(float(x), float(y)) for x, y in projected]

    try:
        from umap import UMAP

        projected = UMAP(
            n_components=2,
            n_neighbors=_umap_neighbor_count(len(embeddings)),
            min_dist=0.12,
            metric="euclidean",
            init="random",
            random_state=42,
        ).fit_transform(pca_matrix)
    except Exception:
        projected = _fallback_projection(pca_matrix)

    return [(float(x), float(y)) for x, y in projected]


def _normalize_coordinates(coordinates: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not coordinates:
        return []

    xs = [x for x, _ in coordinates]
    ys = [y for _, y in coordinates]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    def scale(value: float, low: float, high: float) -> float:
        if math.isclose(low, high):
            return 50.0
        return 8.0 + ((value - low) / (high - low)) * 84.0

    return [(scale(x, min_x, max_x), scale(y, min_y, max_y)) for x, y in coordinates]


def _build_current_scan(scan_id: str | None, points: list[CaseUmapPoint]) -> CaseUmapCurrentScan | None:
    if not scan_id or not points:
        return None

    point_by_id = {point.case_id: point for point in points}
    with SessionLocal() as db:
        row = db.execute(
            text("SELECT similar_cases_json FROM scans WHERE scan_id = :scan_id"),
            {"scan_id": scan_id},
        ).mappings().first()

    if not row:
        return None

    weighted: list[tuple[CaseUmapPoint, float]] = []
    for match in _coerce_list(row["similar_cases_json"]):
        if not isinstance(match, dict):
            continue
        point = point_by_id.get(str(match.get("case_id", "")))
        if point is None:
            continue
        score = _coerce_float(match.get("score"), default=0.0)
        weighted.append((point, max(score, 0.01)))

    if not weighted:
        return None

    total_weight = sum(weight for _, weight in weighted)
    current_x = sum(point.x * weight for point, weight in weighted) / total_weight
    current_y = sum(point.y * weight for point, weight in weighted) / total_weight
    centroids = _cluster_centroids(points)
    distances = {
        variant: round(math.dist((current_x, current_y), centroid), 3)
        for variant, centroid in centroids.items()
    }
    nearest = min(distances, key=distances.get) if distances else "fraud"

    points.append(
        CaseUmapPoint(
            case_id=scan_id,
            label="현재 scan",
            x=round(current_x, 6),
            y=round(current_y, 6),
            variant="current",
            summary="현재 게시글의 유사 사례 가중 중심점입니다.",
        )
    )
    return CaseUmapCurrentScan(scan_id=scan_id, nearest_cluster=nearest, distances=distances)


def _fallback_projection(matrix: np.ndarray) -> np.ndarray:
    if matrix.shape[1] >= 2:
        return matrix[:, :2]

    zeros = np.zeros((matrix.shape[0], 1))
    return np.hstack([matrix[:, :1], zeros])


def _pca_component_count(embeddings: list[list[float]]) -> int:
    if not embeddings:
        return 0
    return max(1, min(50, len(embeddings), len(embeddings[0])))


def _umap_neighbor_count(case_count: int) -> int | None:
    if case_count < MIN_UMAP_CASES:
        return None
    return max(2, min(15, case_count - 1))


def _coerce_flags(value: object | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return [value]
    if not isinstance(value, Iterable):
        return []
    return [str(item) for item in value if item]


def _coerce_list(value: object | None) -> list[object]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _coerce_float(value: object | None, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _cluster_centroids(points: list[CaseUmapPoint]) -> dict[str, tuple[float, float]]:
    centroids: dict[str, tuple[float, float]] = {}
    for variant in ("fraud", "borderline", "safe"):
        cluster = [point for point in points if point.variant == variant]
        if not cluster:
            continue
        centroids[variant] = (
            sum(point.x for point in cluster) / len(cluster),
            sum(point.y for point in cluster) / len(cluster),
        )
    return centroids


def _risk_for_case(case: Case) -> tuple[str, float, str]:
    if case.risk_level in {"high", "medium", "low"}:
        default_score = {"high": 0.85, "medium": 0.5, "low": 0.15}[case.risk_level]
        return (
            case.risk_level,
            case.risk_score if case.risk_score is not None else default_score,
            _variant_from_risk_level(case.risk_level),
        )

    label = case.label or ""
    if "fraud" in label:
        return "high", 0.85, "fraud"
    if label == "unlabeled":
        return "low", 0.15, "safe"
    return "medium", 0.5, "borderline"


def _variant_from_risk_level(risk_level: str) -> str:
    return {"high": "fraud", "medium": "borderline", "low": "safe"}[risk_level]


def _ordered_variant_counts(variants: Iterable[str]) -> dict[str, int]:
    counts = Counter(variants)
    return {variant: counts.get(variant, 0) for variant in ("fraud", "borderline", "safe")}
