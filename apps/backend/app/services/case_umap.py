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


PROJECTION_PIPELINE = "case_chunks.embedding mean -> PCA(<=50) -> Supervised UMAP(2) + Supervised UMAP(3)"
MIN_UMAP_CASES = 10
UMAP_MIN_DIST = 0.3
UMAP_TARGET = "risk_score_ordinal"
UMAP_TARGET_METRIC = "l2"
UMAP_TARGET_WEIGHT = 0.25


@dataclass(frozen=True)
class _CaseEmbedding:
    case: Case
    embedding: list[float]


@dataclass(frozen=True)
class _RiskInfo:
    risk_level: str
    risk_score: float
    variant: str


@dataclass(frozen=True)
class _ProjectedEmbeddings:
    two_d: list[tuple[float, float, float]]
    three_d: list[tuple[float, float, float]]


def build_case_umap(limit: int = 500, scan_id: str | None = None, refresh: bool = False) -> CaseUmapResponse:
    """Return label-guided 2D and 3D case points with risk metadata."""
    del refresh  # Projection is recomputed from DB state; kept for client cache-busting compatibility.
    case_embeddings = _load_case_embeddings(limit=limit)
    risk_info = [_risk_for_case(item.case) for item in case_embeddings]
    projected = _project_embeddings(
        [item.embedding for item in case_embeddings],
        risk_targets=[_ordinal_risk_target(risk.variant) for risk in risk_info],
    )
    coordinates_2d = _normalize_coordinates(projected.two_d)
    coordinates_3d = _normalize_coordinates(projected.three_d)

    points: list[CaseUmapPoint] = []
    for item, risk, (x, y, z), (x_3d, y_3d, z_3d) in zip(
        case_embeddings,
        risk_info,
        coordinates_2d,
        coordinates_3d,
    ):
        points.append(
            CaseUmapPoint(
                case_id=item.case.case_id,
                label=item.case.title or item.case.case_id,
                x=round(float(x), 6),
                y=round(float(y), 6),
                z=round(float(z), 6),
                x_3d=round(float(x_3d), 6),
                y_3d=round(float(y_3d), 6),
                z_3d=round(float(z_3d), 6),
                variant=risk.variant,
                summary=item.case.summary,
                source_url=item.case.source_url,
                platform_hint=item.case.platform_hint,
                risk_level=risk.risk_level,
                risk_score=risk.risk_score,
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
            umap_min_dist=UMAP_MIN_DIST if len(case_embeddings) >= MIN_UMAP_CASES else None,
            umap_target=UMAP_TARGET,
            umap_target_metric=UMAP_TARGET_METRIC,
            umap_target_weight=UMAP_TARGET_WEIGHT if len(case_embeddings) >= MIN_UMAP_CASES else None,
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


def _project_embeddings(embeddings: list[list[float]], risk_targets: list[float]) -> _ProjectedEmbeddings:
    if not embeddings:
        return _ProjectedEmbeddings(two_d=[], three_d=[])

    if len(embeddings) == 1:
        single = [(0.0, 0.0, 0.0)]
        return _ProjectedEmbeddings(two_d=single, three_d=single)

    if len(embeddings) == 2:
        pair = [(-0.5, 0.0, 0.0), (0.5, 0.0, 0.0)]
        return _ProjectedEmbeddings(two_d=pair, three_d=pair)

    matrix = np.asarray(embeddings, dtype=float)
    pca_components = _pca_component_count(embeddings)
    pca_matrix = PCA(n_components=pca_components).fit_transform(matrix)

    if len(embeddings) < MIN_UMAP_CASES:
        projected_2d = _fallback_projection(pca_matrix, dimensions=2)
        projected_3d = _fallback_projection(pca_matrix, dimensions=3)
        return _ProjectedEmbeddings(
            two_d=_as_coordinate_tuples(projected_2d),
            three_d=_as_coordinate_tuples(projected_3d),
        )

    try:
        projected_2d = _run_supervised_umap(pca_matrix, risk_targets=risk_targets, dimensions=2)
        projected_3d = _run_supervised_umap(pca_matrix, risk_targets=risk_targets, dimensions=3)
    except Exception:
        projected_2d = _fallback_projection(pca_matrix, dimensions=2)
        projected_3d = _fallback_projection(pca_matrix, dimensions=3)

    return _ProjectedEmbeddings(
        two_d=_as_coordinate_tuples(projected_2d),
        three_d=_as_coordinate_tuples(projected_3d),
    )


def _run_supervised_umap(matrix: np.ndarray, risk_targets: list[float], dimensions: int) -> np.ndarray:
    from umap import UMAP

    target = np.asarray(risk_targets, dtype=float)
    projected = UMAP(
        n_components=dimensions,
        n_neighbors=_umap_neighbor_count(len(risk_targets)),
        min_dist=UMAP_MIN_DIST,
        metric="euclidean",
        target_metric=UMAP_TARGET_METRIC,
        target_weight=UMAP_TARGET_WEIGHT,
        init="random",
        random_state=42,
    ).fit_transform(matrix, y=target)
    return _fallback_projection(np.asarray(projected, dtype=float), dimensions=3)


def _ordinal_risk_target(variant: str) -> float:
    return {"fraud": 1.0, "borderline": 0.5, "safe": 0.0}.get(variant, 0.5)


def _as_coordinate_tuples(matrix: np.ndarray) -> list[tuple[float, float, float]]:
    return [(float(x), float(y), float(z)) for x, y, z in matrix]


def _normalize_coordinates(coordinates: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    if not coordinates:
        return []

    xs = [x for x, _, _ in coordinates]
    ys = [y for _, y, _ in coordinates]
    zs = [z for _, _, z in coordinates]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)

    def scale(value: float, low: float, high: float) -> float:
        if math.isclose(low, high):
            return 50.0
        return 8.0 + ((value - low) / (high - low)) * 84.0

    return [
        (scale(x, min_x, max_x), scale(y, min_y, max_y), scale(z, min_z, max_z))
        for x, y, z in coordinates
    ]


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
    current_z = sum(point.z * weight for point, weight in weighted) / total_weight
    current_x_3d = sum(_point_3d(point)[0] * weight for point, weight in weighted) / total_weight
    current_y_3d = sum(_point_3d(point)[1] * weight for point, weight in weighted) / total_weight
    current_z_3d = sum(_point_3d(point)[2] * weight for point, weight in weighted) / total_weight
    centroids = _cluster_centroids(points)
    distances = {
        variant: round(math.dist((current_x_3d, current_y_3d, current_z_3d), centroid), 3)
        for variant, centroid in centroids.items()
    }
    nearest = min(distances, key=distances.get) if distances else "fraud"

    points.append(
        CaseUmapPoint(
            case_id=scan_id,
            label="현재 scan",
            x=round(current_x, 6),
            y=round(current_y, 6),
            z=round(current_z, 6),
            x_3d=round(current_x_3d, 6),
            y_3d=round(current_y_3d, 6),
            z_3d=round(current_z_3d, 6),
            variant="current",
            summary="현재 게시글의 유사 사례 가중 중심점입니다.",
        )
    )
    return CaseUmapCurrentScan(scan_id=scan_id, nearest_cluster=nearest, distances=distances)


def _fallback_projection(matrix: np.ndarray, dimensions: int) -> np.ndarray:
    if matrix.shape[1] >= dimensions:
        projected = matrix[:, :dimensions]
    else:
        zeros = np.zeros((matrix.shape[0], dimensions - matrix.shape[1]))
        projected = np.hstack([matrix, zeros])

    if dimensions >= 3:
        return projected[:, :3]

    zeros = np.zeros((matrix.shape[0], 3 - dimensions))
    return np.hstack([projected[:, :dimensions], zeros])


def _pca_component_count(embeddings: list[list[float]]) -> int:
    if not embeddings:
        return 0
    return max(1, min(50, len(embeddings), len(embeddings[0])))


def _umap_neighbor_count(case_count: int) -> int | None:
    if case_count < MIN_UMAP_CASES:
        return None
    return max(2, min(35, case_count - 1))


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


def _cluster_centroids(points: list[CaseUmapPoint]) -> dict[str, tuple[float, float, float]]:
    centroids: dict[str, tuple[float, float, float]] = {}
    for variant in ("fraud", "borderline", "safe"):
        cluster = [point for point in points if point.variant == variant]
        if not cluster:
            continue
        centroids[variant] = (
            sum(_point_3d(point)[0] for point in cluster) / len(cluster),
            sum(_point_3d(point)[1] for point in cluster) / len(cluster),
            sum(_point_3d(point)[2] for point in cluster) / len(cluster),
        )
    return centroids


def _point_3d(point: CaseUmapPoint) -> tuple[float, float, float]:
    return (
        point.x_3d if point.x_3d is not None else point.x,
        point.y_3d if point.y_3d is not None else point.y,
        point.z_3d if point.z_3d is not None else point.z,
    )


def _risk_for_case(case: Case) -> _RiskInfo:
    if case.risk_level in {"high", "medium", "low"}:
        default_score = {"high": 0.85, "medium": 0.5, "low": 0.15}[case.risk_level]
        return _RiskInfo(
            risk_level=case.risk_level,
            risk_score=case.risk_score if case.risk_score is not None else default_score,
            variant=_variant_from_risk_level(case.risk_level),
        )

    label = case.label or ""
    if "fraud" in label:
        return _RiskInfo(risk_level="high", risk_score=0.85, variant="fraud")
    if label == "unlabeled":
        return _RiskInfo(risk_level="low", risk_score=0.15, variant="safe")
    return _RiskInfo(risk_level="medium", risk_score=0.5, variant="borderline")


def _variant_from_risk_level(risk_level: str) -> str:
    return {"high": "fraud", "medium": "borderline", "low": "safe"}[risk_level]


def _ordered_variant_counts(variants: Iterable[str]) -> dict[str, int]:
    counts = Counter(variants)
    return {variant: counts.get(variant, 0) for variant in ("fraud", "borderline", "safe")}
