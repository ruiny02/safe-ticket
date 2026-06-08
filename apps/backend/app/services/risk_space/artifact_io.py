"""Persistence helpers for active risk-space model artifacts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from app.core.config import get_settings


ACTIVE_ARTIFACT_FILE = "active.joblib"


@dataclass
class RiskSpaceArtifact:
    """Serializable artifact for PLS risk-aware projection and scoring."""

    model_version: str
    created_at: str
    embedding_dim: int
    preprocessor_type: str
    pca: Any
    pls: Any
    calibrator: Any
    prototype_vectors: dict[str, np.ndarray]
    historical_case_ids: list[str]
    historical_z: np.ndarray
    historical_y: np.ndarray
    historical_labels: list[str]
    historical_x_raw: np.ndarray
    historical_metadata: list[dict[str, Any]]
    score_weights: dict[str, float]
    prototype_temperature: float
    neighbor_temperature: float
    top_k: int
    residual_coef: np.ndarray
    residual_intercept: np.ndarray
    residual_reducer_type: str
    residual_reducer: Any
    normalization: dict[str, float]
    residual_space_type: str = "pls"
    residual_preprocessor: Any = None
    scoring_strategy: str = "pls_axis_primary_v1"
    scoring_variant: str = "pls_axis_neighbors"
    component_weights: list[float] = field(default_factory=list)
    prototype_strategy: str = "risk_axis_centroid_distance"
    neighbor_strategy: str = "risk_axis_density"
    risk_axis_tau: float = 0.10
    historical_axis_scores: np.ndarray = field(default_factory=lambda: np.asarray([], dtype=float))
    prototype_axis_centroids: dict[str, float] = field(default_factory=dict)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def transform_preprocessor(self, matrix: np.ndarray) -> np.ndarray:
        """Apply the saved optional PCA preprocessor."""
        if self.preprocessor_type == "pca" and self.pca is not None:
            return self.pca.transform(matrix)
        return matrix


def new_model_version() -> str:
    """Return a stable timestamped model version."""
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    return f"risk_space_pls_v1_{stamp}"


def artifact_dir() -> Path:
    """Return configured artifact directory."""
    return Path(get_settings().risk_space_artifact_dir)


def save_artifact(artifact: RiskSpaceArtifact, *, activate: bool = False) -> Path:
    """Persist one artifact and optionally mark it active."""
    directory = artifact_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{artifact.model_version}.joblib"
    joblib.dump(artifact, path)
    if activate:
        joblib.dump(artifact, directory / ACTIVE_ARTIFACT_FILE)
    return path


def load_active_artifact() -> RiskSpaceArtifact | None:
    """Load the currently active artifact, if present."""
    path = artifact_dir() / ACTIVE_ARTIFACT_FILE
    if not path.exists():
        return None
    loaded = joblib.load(path)
    if not isinstance(loaded, RiskSpaceArtifact):
        return None
    return loaded


def activate_artifact(model_version: str) -> Path:
    """Mark an existing artifact version as active."""
    source = artifact_dir() / f"{model_version}.joblib"
    if not source.exists():
        raise FileNotFoundError(source)
    artifact = joblib.load(source)
    active = artifact_dir() / ACTIVE_ARTIFACT_FILE
    joblib.dump(artifact, active)
    return active


def list_artifacts() -> list[str]:
    """List saved artifact versions."""
    directory = artifact_dir()
    if not directory.exists():
        return []
    return sorted(path.stem for path in directory.glob("risk_space_pls_v1_*.joblib"))
