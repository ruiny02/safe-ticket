"""Build backend-owned UMAP projection data from persisted fraud-memory cases."""

from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

import numpy as np
from sklearn.decomposition import PCA
from sqlalchemy.orm import selectinload

from app.db.models import Case
from app.db.session import SessionLocal
from app.schemas.case_umap import CaseUmapPoint, CaseUmapProjection, CaseUmapResponse


PROJECTION_PIPELINE = "case_chunks.embedding mean -> PCA(<=50) -> UMAP(2)"
MIN_UMAP_CASES = 10


@dataclass(frozen=True)
class _CaseEmbedding:
    case: Case
    embedding: list[float]


def build_case_umap(limit: int = 500) -> CaseUmapResponse:
    """Return 2D case points with risk metadata for frontend UMAP visualization."""
    case_embeddings = _load_case_embeddings(limit=limit)
    coordinates = _project_embeddings([item.embedding for item in case_embeddings])

    points = [
        CaseUmapPoint(
            case_id=item.case.case_id,
            x=round(float(x), 6),
            y=round(float(y), 6),
            title=item.case.title,
            summary=item.case.summary,
            source_url=item.case.source_url,
            platform_hint=item.case.platform_hint,
            risk_level=item.case.risk_level,
            risk_score=item.case.risk_score,
            risk_flags=_coerce_flags(item.case.risk_flags_json),
        )
        for item, (x, y) in zip(case_embeddings, coordinates)
    ]

    risk_counts = _ordered_risk_counts(point.risk_level for point in points)

    return CaseUmapResponse(
        points=points,
        total_cases=len(points),
        risk_counts=risk_counts,
        projection=CaseUmapProjection(
            pipeline=PROJECTION_PIPELINE,
            pca_components=_pca_component_count([item.embedding for item in case_embeddings]),
            umap_neighbors=_umap_neighbor_count(len(case_embeddings)),
            umap_min_dist=0.12 if len(case_embeddings) >= 3 else None,
        ),
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


def _ordered_risk_counts(risk_levels: Iterable[str | None]) -> dict[str, int]:
    counts = Counter(level for level in risk_levels if level)
    ordered = {
        level: counts[level]
        for level in ("high", "medium", "low")
        if counts[level]
    }
    for level, count in sorted(counts.items()):
        if level not in ordered:
            ordered[level] = count
    return ordered
