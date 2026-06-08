"""Projection helpers for historical cases and current scans."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.services.risk_space.artifact_io import RiskSpaceArtifact
from app.services.risk_space.cosine_scoring import RiskSpaceScore, score_query_in_artifact
from app.services.risk_space.data_loader import l2_normalize_vector


@dataclass(frozen=True)
class ProjectionCoordinates:
    """Score-aligned 2D/3D map coordinates."""

    x2d: float
    y2d: float
    x3d: float
    y3d: float
    z3d: float
    clipped: bool = False


@dataclass(frozen=True)
class ProjectedRiskPoint:
    """Projected case or scan with score metadata."""

    point_id: str
    label: str
    score: float
    embedding_risk_score: float
    coordinates: ProjectionCoordinates
    metadata: dict[str, Any] = field(default_factory=dict)
    risk_score: RiskSpaceScore | None = None


def project_embedding(
    *,
    artifact: RiskSpaceArtifact,
    point_id: str,
    label: str,
    embedding: np.ndarray,
    mode_score: float | None = None,
    exclude_case_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ProjectedRiskPoint:
    """Score and project one embedding with the saved artifact."""
    risk_score = score_query_in_artifact(
        artifact=artifact,
        query_embedding=l2_normalize_vector(embedding),
        exclude_case_id=exclude_case_id,
    )
    display_score = risk_score.embedding_risk_score if mode_score is None else float(np.clip(mode_score, 0.0, 1.0))
    coordinates = coordinates_for_score_and_z(
        artifact=artifact,
        score=display_score,
        query_z=_query_z(artifact, embedding),
    )
    return ProjectedRiskPoint(
        point_id=point_id,
        label=label,
        score=display_score,
        embedding_risk_score=risk_score.embedding_risk_score,
        coordinates=coordinates,
        metadata=metadata or {},
        risk_score=risk_score,
    )


def coordinates_for_score_and_z(
    *,
    artifact: RiskSpaceArtifact,
    score: float,
    query_z: np.ndarray,
) -> ProjectionCoordinates:
    """Convert PLS latent vector into score-aligned 2D/3D coordinates."""
    x = _score_to_axis(score)
    residual = query_z - (artifact.residual_coef * score + artifact.residual_intercept)
    reduced = _reduce_residual(artifact, residual.reshape(1, -1))[0]
    y_raw = float(reduced[0])
    z_raw = float(reduced[1]) if len(reduced) > 1 else 0.0
    y, y_clipped = _scale_to_axis(y_raw, artifact.normalization.get("y_min", 0.0), artifact.normalization.get("y_max", 1.0))
    z, z_clipped = _scale_to_axis(z_raw, artifact.normalization.get("z_min", 0.0), artifact.normalization.get("z_max", 1.0))
    return ProjectionCoordinates(
        x2d=round(x, 6),
        y2d=round(y, 6),
        x3d=round(x, 6),
        y3d=round(y, 6),
        z3d=round(z, 6),
        clipped=y_clipped or z_clipped,
    )


def _query_z(artifact: RiskSpaceArtifact, embedding: np.ndarray) -> np.ndarray:
    query_x = l2_normalize_vector(np.asarray(embedding, dtype=float)).reshape(1, -1)
    preprocessed = artifact.transform_preprocessor(query_x)
    if getattr(artifact, "residual_space_type", "pls") == "pca_embedding":
        residual_preprocessor = getattr(artifact, "residual_preprocessor", None)
        if residual_preprocessor is not None:
            return np.asarray(residual_preprocessor.transform(query_x), dtype=float)[0]
    if getattr(artifact, "residual_space_type", "pls") == "preprocessed_embedding":
        return np.asarray(preprocessed, dtype=float)[0]
    z = np.asarray(artifact.pls.transform(preprocessed), dtype=float)[0]
    return z


def _reduce_residual(artifact: RiskSpaceArtifact, residual: np.ndarray) -> np.ndarray:
    if artifact.residual_reducer is None:
        return np.zeros((residual.shape[0], 2), dtype=float)
    reduced = np.asarray(artifact.residual_reducer.transform(residual), dtype=float)
    if reduced.ndim == 1:
        reduced = reduced.reshape(-1, 1)
    if reduced.shape[1] == 1:
        reduced = np.hstack([reduced, np.zeros((reduced.shape[0], 1))])
    return reduced[:, :2]


def _score_to_axis(score: float) -> float:
    return 8.0 + 84.0 * float(np.clip(score, 0.0, 1.0))


def _scale_to_axis(value: float, low: float, high: float) -> tuple[float, bool]:
    if np.isclose(low, high):
        return 50.0, False
    scaled = 8.0 + ((value - low) / (high - low)) * 84.0
    clipped = bool(scaled < 8.0 or scaled > 92.0)
    return float(np.clip(scaled, 8.0, 92.0)), clipped
