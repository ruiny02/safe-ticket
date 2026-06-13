"""High-level risk-space scoring and projection service."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from itertools import islice
from typing import Any, Literal

import numpy as np
from sklearn.decomposition import PCA

from app.repositories.db_store import db_store
from app.schemas.risk_map import RiskMapNeighbor, RiskMapPoint, RiskMapResponse, ScanRiskProjectionResponse
from app.schemas.scan import PipelineOutboundPayload, RiskScoreComponent
from app.services.rag.context import build_listing_text
from app.services.rag.embeddings import QueryEmbeddingError, embed_query_text
from app.services.risk_space.artifact_io import RiskSpaceArtifact, load_active_artifact, save_artifact
from app.services.risk_space.cosine_scoring import RiskSpaceScore, score_query_in_artifact
from app.services.risk_space.data_loader import l2_normalize_vector, load_case_embedding_dataset
from app.services.risk_space.project_scan import project_embedding
from app.services.risk_space.train import _fit_residual_reducer, _residualize, train_risk_space_model


RiskLevel = Literal["low", "medium", "high"]
RISK_TARGET_SOURCE = "case_risk_score_continuous_pls7_v2"
_VISUALIZATION_ARTIFACT_CACHE: dict[tuple[str, str], RiskSpaceArtifact] = {}


class RiskSpaceUnavailableError(RuntimeError):
    """Raised when the risk-space model cannot be trained or applied."""


@dataclass(frozen=True)
class _SemanticResidualProjection:
    """Projection state for x=PLS1 risk and y/z=semantic residual UMAP."""

    reducer_object: Any
    reducer_type: str
    pca: PCA | None
    direction: np.ndarray
    historical_reduced: np.ndarray
    normalization: dict[str, float]
    warnings: list[str]
    metrics: dict[str, Any]


def load_or_train_active_artifact() -> RiskSpaceArtifact:
    """Load active artifact or train one from current DB embeddings."""
    artifact = load_active_artifact()
    if artifact is not None and artifact.metrics.get("risk_target_source") == RISK_TARGET_SOURCE:
        return artifact

    dataset = load_case_embedding_dataset()
    artifact, _report = train_risk_space_model(dataset, reducer="pca", candidate_mode="active")
    save_artifact(artifact, activate=True)
    return artifact


def load_or_train_visualization_artifact(*, reducer: str) -> RiskSpaceArtifact:
    """Return an artifact with the requested residual visualization reducer.

    The active artifact controls runtime scoring. If the requested reducer differs,
    train a transient artifact so visualization changes do not silently replace the
    active scoring artifact.
    """
    artifact = load_or_train_active_artifact()
    if artifact.residual_reducer_type == reducer:
        return artifact

    cache_key = (artifact.model_version, reducer)
    cached = _VISUALIZATION_ARTIFACT_CACHE.get(cache_key)
    if cached is not None:
        return cached

    transient = _with_residual_visualization_reducer(artifact, reducer=reducer)
    _VISUALIZATION_ARTIFACT_CACHE[cache_key] = transient
    return transient


def _with_residual_visualization_reducer(artifact: RiskSpaceArtifact, *, reducer: str) -> RiskSpaceArtifact:
    """Clone the active scoring artifact and refit only its residual visualizer."""
    cloned = deepcopy(artifact)
    residual_preprocessor, residual_source = _fit_visualization_pca(artifact.historical_x_raw)
    scores = np.asarray(
        [
            score_query_in_artifact(
                artifact=artifact,
                query_embedding=artifact.historical_x_raw[row],
                exclude_case_id=artifact.historical_case_ids[row],
            ).embedding_risk_score
            for row in range(artifact.historical_x_raw.shape[0])
        ],
        dtype=float,
    )
    residual_coef, residual_intercept, residual_matrix = _residualize(residual_source, scores)
    reducer_object, reducer_type, normalization, warnings = _fit_residual_reducer(
        residual_matrix,
        reducer=reducer,
    )
    cloned.residual_coef = residual_coef
    cloned.residual_intercept = residual_intercept
    cloned.residual_reducer = reducer_object
    cloned.residual_reducer_type = reducer_type
    cloned.residual_space_type = "pca_embedding"
    cloned.residual_preprocessor = residual_preprocessor
    cloned.normalization = normalization
    cloned.metrics = {
        **artifact.metrics,
        "residual_visualization": {
            "source_space": "pca_embedding",
            "source_preprocessor": "pca",
            "source_dim": int(residual_source.shape[1]),
            "reducer": reducer_type,
        },
    }
    cloned.warnings = [*artifact.warnings, *warnings]
    return cloned


def _fit_visualization_pca(matrix: np.ndarray) -> tuple[PCA, np.ndarray]:
    """Reduce high-dimensional embeddings before residual UMAP visualization."""
    components = max(1, min(50, matrix.shape[0] - 1, matrix.shape[1]))
    reducer = PCA(n_components=components, whiten=False, random_state=42)
    return reducer, reducer.fit_transform(matrix)


def score_listing_text(listing_text: str) -> tuple[RiskSpaceScore | None, RiskSpaceArtifact | None, list[str]]:
    """Embed and score current listing text using the active supervised risk space."""
    warnings: list[str] = []
    try:
        artifact = load_or_train_active_artifact()
    except Exception as exc:
        return None, None, [f"risk_space_artifact_unavailable:{exc}"]

    try:
        query_embedding = np.asarray(
            embed_query_text(listing_text, output_dimensionality=artifact.embedding_dim),
            dtype=float,
        )
    except QueryEmbeddingError as exc:
        return None, artifact, [f"query_embedding_unavailable:{exc}"]

    try:
        score = score_query_in_artifact(artifact=artifact, query_embedding=query_embedding)
        warnings.extend(score.warnings)
        return score, artifact, warnings
    except Exception as exc:
        return None, artifact, [f"risk_space_score_unavailable:{exc}"]


def risk_level_from_score(score: float) -> RiskLevel:
    """Map final score to public risk level."""
    if score >= 0.70:
        return "high"
    if score >= 0.35:
        return "medium"
    return "low"


def build_embedding_breakdown(
    *,
    score: RiskSpaceScore | None,
    artifact: RiskSpaceArtifact | None,
    warnings: list[str],
) -> list[RiskScoreComponent]:
    """Build API-compatible score components for the embedding-only model."""
    if score is None:
        return [
            RiskScoreComponent(
                component="embedding_risk_score_unavailable",
                points=0,
                reason="risk-space 모델 점수를 계산하지 못해 rule 기반 조정만 사용했습니다.",
                value=0.0,
                metadata={"warnings": warnings},
            )
        ]

    return [
        RiskScoreComponent(
            component="embedding_risk_score",
            points=round(score.embedding_risk_score * 100),
            reason="PLS1 calibrated score를 주 신호로 사용하고 PLS7 prototype/neighbor cosine은 보조 신호로 제한했습니다.",
            value=round(score.embedding_risk_score, 6),
            metadata={
                "projection_type": "embedding_pls1_primary_pls7_cosine_v1",
                "model_version": artifact.model_version if artifact else None,
                "scoring_variant": artifact.scoring_variant if artifact else None,
                "calibrated_pls_score": round(score.calibrated_pls_score, 6),
                "prototype_score": round(score.prototype_score, 6),
                "neighbor_score": round(score.neighbor_score, 6),
                "prototype_cosines": score.prototype_cosines,
                "top_neighbors": [
                    {
                        "case_id": neighbor.case_id,
                        "label": neighbor.label,
                        "similarity": neighbor.cosine_similarity,
                        "weighted_contribution": neighbor.weighted_contribution,
                    }
                    for neighbor in score.top_neighbors
                ],
                "warnings": warnings,
            },
        )
    ]


def build_risk_map_response(
    *,
    dim: int,
    mode: str,
    reducer: str = "pca",
    limit: int = 200,
    scan_id: str | None = None,
    projection: str = "pls7_umap",
) -> RiskMapResponse:
    """Return score-aligned historical case map points."""
    if projection == "pls7_umap":
        return _build_pls7_umap_risk_map_response(dim=dim, mode=mode, reducer=reducer, limit=limit, scan_id=scan_id)

    artifact = load_or_train_visualization_artifact(reducer=reducer)
    points: list[RiskMapPoint] = []
    historical_rows = zip(
        artifact.historical_case_ids,
        artifact.historical_labels,
        artifact.historical_x_raw,
        artifact.historical_metadata,
        strict=True,
    )
    for case_id, label, embedding, metadata in islice(historical_rows, limit):
        final_score_source = "embedding_score"
        mode_score: float | None = None
        if mode == "final":
            raw_score = metadata.get("risk_score")
            if isinstance(raw_score, int | float):
                mode_score = float(raw_score)
                final_score_source = "stored_risk_score"
            else:
                mode_score = {"safe": 0.0, "borderline": 0.5, "fraud": 1.0}.get(label, 0.5)
                final_score_source = "label_fallback"

        projected = project_embedding(
            artifact=artifact,
            point_id=case_id,
            label=label,
            embedding=embedding,
            mode_score=mode_score,
            exclude_case_id=case_id,
            metadata=metadata,
        )
        points.append(
            RiskMapPoint(
                case_id=case_id,
                label=label,  # type: ignore[arg-type]
                score=round(projected.score, 6),
                x=projected.coordinates.x3d if dim == 3 else projected.coordinates.x2d,
                y=projected.coordinates.y3d if dim == 3 else projected.coordinates.y2d,
                z=projected.coordinates.z3d if dim == 3 else None,
                embedding_risk_score=round(projected.embedding_risk_score, 6),
                final_score_source=final_score_source,
                title=metadata.get("title"),
                platform=metadata.get("platform"),
                summary=metadata.get("summary"),
            )
        )

    current_point = _build_current_risk_map_point(artifact=artifact, scan_id=scan_id, mode=mode, dim=dim)
    if current_point is not None:
        points.append(current_point)

    return RiskMapResponse(
        model_version=artifact.model_version,
        mode=mode,  # type: ignore[arg-type]
        x_axis="final_risk_score" if mode == "final" else "embedding_risk_score",
        z_axis="residual_component_2" if dim == 3 else None,
        reducer=artifact.residual_reducer_type,
        points=points,
        metrics=artifact.metrics,
        warnings=artifact.warnings,
    )


def _build_pls7_umap_risk_map_response(
    *,
    dim: int,
    mode: str,
    reducer: str,
    limit: int,
    scan_id: str | None,
) -> RiskMapResponse:
    """Return x=PLS1 risk with y/z from semantic residual UMAP.

    The scoring artifact still uses PLS7 for prototype/neighbor stabilizers.
    Visualization intentionally avoids feeding PLS7 directly into UMAP because
    that over-separates risk classes and hides semantic neighborhoods.
    """
    artifact = load_or_train_active_artifact()
    display_count = max(1, min(limit, len(artifact.historical_case_ids)))
    projection = _fit_semantic_residual_projection(
        artifact=artifact,
        historical_x=artifact.historical_x_raw[:display_count],
        reducer=reducer,
    )

    points: list[RiskMapPoint] = []
    for index in range(display_count):
        case_id = artifact.historical_case_ids[index]
        label = artifact.historical_labels[index]
        metadata = artifact.historical_metadata[index]
        scored = score_query_in_artifact(
            artifact=artifact,
            query_embedding=artifact.historical_x_raw[index],
            exclude_case_id=case_id,
        )
        display_score = scored.embedding_risk_score
        final_score_source = "embedding_score"
        if mode == "final":
            raw_score = metadata.get("risk_score")
            if isinstance(raw_score, int | float):
                display_score = float(raw_score)
                final_score_source = "stored_risk_score"
            else:
                final_score_source = "label_fallback"

        x, y, z = _scale_risk_residual_coordinates(
            scored.calibrated_pls_score,
            projection.historical_reduced[index],
            projection.normalization,
        )
        points.append(
            RiskMapPoint(
                case_id=case_id,
                label=label,  # type: ignore[arg-type]
                score=round(float(display_score), 6),
                x=x,
                y=y,
                z=z if dim == 3 else None,
                embedding_risk_score=round(scored.embedding_risk_score, 6),
                final_score_source=final_score_source,
                title=metadata.get("title"),
                platform=metadata.get("platform"),
                summary=metadata.get("summary"),
            )
        )

    current_point = _build_current_pls7_umap_point(
        artifact=artifact,
        scan_id=scan_id,
        mode=mode,
        dim=dim,
        projection=projection,
    )
    if current_point is not None:
        points.append(current_point)

    metrics = {
        **artifact.metrics,
        "projection_type": "pls1_semantic_residual_umap_v1",
        "pls_components": int(artifact.historical_z.shape[1]),
        "component_weights": artifact.component_weights,
        "risk_axis_source": "calibrated_pls_component_1",
        "residual_source": "raw_embedding_minus_pls1_direction",
        "semantic_preprocessor": projection.metrics.get("semantic_preprocessor"),
        "semantic_pca_components": projection.metrics.get("semantic_pca_components"),
        "umap_neighbors": projection.metrics.get("umap_neighbors"),
        "umap_min_dist": projection.metrics.get("umap_min_dist"),
        "umap_metric": projection.metrics.get("umap_metric"),
        "note": "X is calibrated PLS1 risk; Y/Z are unsupervised UMAP of semantic residuals.",
    }

    return RiskMapResponse(
        model_version=artifact.model_version,
        projection_type="pls1_semantic_residual_umap_v1",
        mode=mode,  # type: ignore[arg-type]
        score_aligned=False,
        x_axis="calibrated_pls1_risk_axis",
        y_axis="semantic_residual_umap_component_1",
        z_axis="semantic_residual_umap_component_2" if dim == 3 else None,
        reducer=projection.reducer_type,
        points=points,
        metrics=metrics,
        warnings=[*artifact.warnings, *projection.warnings],
    )


def _fit_semantic_residual_projection(
    *,
    artifact: RiskSpaceArtifact,
    historical_x: np.ndarray,
    reducer: str,
) -> _SemanticResidualProjection:
    """Fit y/z coordinates from semantic embedding residuals after removing PLS1."""
    preprocessed = artifact.transform_preprocessor(np.asarray(historical_x, dtype=float))
    direction = _pls1_feature_direction(artifact, preprocessed.shape[1])
    residual = _remove_pls1_direction(preprocessed, direction)
    pca, residual_source = _fit_semantic_residual_pca(residual)
    reduced, reducer_object, reducer_type, normalization, warnings, reducer_metrics = _fit_semantic_residual_reducer(
        residual_source,
        reducer=reducer,
    )
    metrics = {
        **reducer_metrics,
        "semantic_preprocessor": "pca" if pca is not None else "identity",
        "semantic_pca_components": int(residual_source.shape[1]),
    }
    return _SemanticResidualProjection(
        reducer_object=reducer_object,
        reducer_type=reducer_type,
        pca=pca,
        direction=direction,
        historical_reduced=reduced,
        normalization=normalization,
        warnings=warnings,
        metrics=metrics,
    )


def _pls1_feature_direction(artifact: RiskSpaceArtifact, width: int) -> np.ndarray:
    """Return the normalized feature-space direction for PLS component 1."""
    weights = getattr(artifact.pls, "x_weights_", None)
    if weights is None:
        direction = np.zeros(width, dtype=float)
        direction[0] = 1.0
        return direction

    matrix = np.asarray(weights, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != width or matrix.shape[1] == 0:
        direction = np.zeros(width, dtype=float)
        direction[0] = 1.0
        return direction

    direction = matrix[:, 0]
    norm = float(np.linalg.norm(direction))
    if np.isclose(norm, 0.0):
        fallback = np.zeros(width, dtype=float)
        fallback[0] = 1.0
        return fallback
    return direction / norm


def _remove_pls1_direction(matrix: np.ndarray, direction: np.ndarray) -> np.ndarray:
    """Remove the first risk-axis direction while preserving semantic residuals."""
    array = np.asarray(matrix, dtype=float)
    vector = np.asarray(direction, dtype=float)
    if array.ndim == 1:
        array = array.reshape(1, -1)
    if vector.size != array.shape[1]:
        raise ValueError(f"semantic_residual_direction_mismatch:{vector.size}!={array.shape[1]}")
    projection = array @ vector
    return array - projection.reshape(-1, 1) * vector.reshape(1, -1)


def _fit_semantic_residual_pca(residual: np.ndarray) -> tuple[PCA | None, np.ndarray]:
    """Use PCA as a stable semantic compressor before UMAP when dimensions are high."""
    matrix = np.asarray(residual, dtype=float)
    if matrix.shape[0] < 2 or matrix.shape[1] <= 50:
        return None, matrix
    components = max(1, min(50, matrix.shape[0] - 1, matrix.shape[1]))
    reducer = PCA(n_components=components, whiten=False, random_state=42)
    return reducer, np.asarray(reducer.fit_transform(matrix), dtype=float)


def _fit_semantic_residual_reducer(
    residual: np.ndarray,
    *,
    reducer: str,
) -> tuple[np.ndarray, Any, str, dict[str, float], list[str], dict[str, Any]]:
    """Reduce semantic residuals to 2D coordinates used as y/z in the map."""
    warnings: list[str] = []
    matrix = np.asarray(residual, dtype=float)
    if matrix.shape[0] < 2:
        reduced = np.zeros((matrix.shape[0], 2), dtype=float)
        return reduced, None, "none", _residual_yz_normalization(reduced), ["semantic_residual_insufficient_samples"], {}

    if reducer == "umap" and matrix.shape[0] >= 10 and matrix.shape[1] >= 2:
        n_neighbors = max(2, min(45, matrix.shape[0] - 1))
        min_dist = 0.38
        try:
            from umap import UMAP

            reducer_object: Any = UMAP(
                n_components=2,
                n_neighbors=n_neighbors,
                min_dist=min_dist,
                metric="euclidean",
                init="random",
                random_state=42,
            )
            reduced = np.asarray(reducer_object.fit_transform(matrix), dtype=float)
            reducer_type = "umap"
            metrics = {
                "umap_neighbors": n_neighbors,
                "umap_min_dist": min_dist,
                "umap_metric": "euclidean",
            }
        except Exception as exc:
            warnings.append(f"semantic_residual_umap_fallback:{exc}")
            reducer_object, reduced, reducer_type = _fit_semantic_residual_pca_reducer(matrix)
            metrics = {"umap_neighbors": None, "umap_min_dist": None, "umap_metric": None}
    else:
        reducer_object, reduced, reducer_type = _fit_semantic_residual_pca_reducer(matrix)
        metrics = {"umap_neighbors": None, "umap_min_dist": None, "umap_metric": None}

    reduced = _pad_reduced_2d(reduced)
    return reduced, reducer_object, reducer_type, _residual_yz_normalization(reduced), warnings, metrics


def _fit_semantic_residual_pca_reducer(residual: np.ndarray) -> tuple[PCA, np.ndarray, str]:
    components = max(1, min(2, residual.shape[0] - 1, residual.shape[1]))
    reducer_object = PCA(n_components=components, whiten=False, random_state=42)
    reduced = np.asarray(reducer_object.fit_transform(residual), dtype=float)
    return reducer_object, _pad_reduced_2d(reduced), "pca"


def _project_semantic_residual(
    *,
    artifact: RiskSpaceArtifact,
    projection: _SemanticResidualProjection,
    matrix: np.ndarray,
) -> np.ndarray:
    """Project new embeddings into the fitted semantic residual reducer."""
    preprocessed = artifact.transform_preprocessor(np.asarray(matrix, dtype=float))
    residual = _remove_pls1_direction(preprocessed, projection.direction)
    residual_source = projection.pca.transform(residual) if projection.pca is not None else residual
    if projection.reducer_object is None:
        return np.zeros((residual_source.shape[0], 2), dtype=float)
    reduced = np.asarray(projection.reducer_object.transform(residual_source), dtype=float)
    return _pad_reduced_2d(reduced)


def _pad_reduced_2d(reduced: np.ndarray) -> np.ndarray:
    if reduced.ndim == 1:
        reduced = reduced.reshape(-1, 1)
    if reduced.shape[1] >= 2:
        return reduced[:, :2]
    return np.hstack([reduced, np.zeros((reduced.shape[0], 2 - reduced.shape[1]))])


def _residual_yz_normalization(reduced: np.ndarray) -> dict[str, float]:
    padded = _pad_reduced_2d(np.asarray(reduced, dtype=float))
    return {
        "y_min": float(np.min(padded[:, 0])),
        "y_max": float(np.max(padded[:, 0])),
        "z_min": float(np.min(padded[:, 1])),
        "z_max": float(np.max(padded[:, 1])),
    }


def _scale_risk_residual_coordinates(
    risk_axis_score: float,
    residual_row: np.ndarray,
    normalization: dict[str, float],
) -> tuple[float, float, float]:
    row = _pad_reduced_2d(np.asarray(residual_row, dtype=float).reshape(1, -1))[0]
    x = _scale_axis_value(float(np.clip(risk_axis_score, 0.0, 1.0)), 0.0, 1.0)
    y = _scale_axis_value(float(row[0]), normalization["y_min"], normalization["y_max"])
    z = _scale_axis_value(float(row[1]), normalization["z_min"], normalization["z_max"])
    return round(x, 6), round(y, 6), round(z, 6)


def _scale_axis_value(value: float, low: float, high: float) -> float:
    if np.isclose(low, high):
        return 50.0
    return float(np.clip(8.0 + ((value - low) / (high - low)) * 84.0, 8.0, 92.0))


def _build_current_pls7_umap_point(
    *,
    artifact: RiskSpaceArtifact,
    scan_id: str | None,
    mode: str,
    dim: int,
    projection: _SemanticResidualProjection,
) -> RiskMapPoint | None:
    if not scan_id:
        return None

    exchange = db_store.get_pipeline_exchange(scan_id)
    scan = db_store.get_scan(scan_id)
    if exchange is None or scan is None:
        return None

    listing_text = build_listing_text(exchange.outbound_payload)
    query_embedding = np.asarray(embed_query_text(listing_text, output_dimensionality=artifact.embedding_dim), dtype=float)
    query_x = l2_normalize_vector(query_embedding).reshape(1, -1)
    scored = score_query_in_artifact(artifact=artifact, query_embedding=query_embedding)
    display_score = scored.embedding_risk_score
    final_score_source = "scan_embedding_score"
    if mode == "final" and scan.risk_score is not None:
        display_score = float(scan.risk_score)
        final_score_source = "scan_final_risk_score"
    reduced = _project_semantic_residual(artifact=artifact, projection=projection, matrix=query_x)
    x, y, z = _scale_risk_residual_coordinates(scored.calibrated_pls_score, reduced[0], projection.normalization)

    return RiskMapPoint(
        case_id=scan_id,
        label="current",
        score=round(float(display_score), 6),
        x=x,
        y=y,
        z=z if dim == 3 else None,
        embedding_risk_score=round(scored.embedding_risk_score, 6),
        final_score_source=final_score_source,
        title=exchange.outbound_payload.page_title,
        platform=exchange.outbound_payload.platform,
        summary=scan.summary,
    )


def _build_current_risk_map_point(
    *,
    artifact: RiskSpaceArtifact,
    scan_id: str | None,
    mode: str,
    dim: int,
) -> RiskMapPoint | None:
    """Project the requested scan into the same risk-map coordinate system."""
    if not scan_id:
        return None

    exchange = db_store.get_pipeline_exchange(scan_id)
    scan = db_store.get_scan(scan_id)
    if exchange is None or scan is None:
        return None

    listing_text = build_listing_text(exchange.outbound_payload)
    query_embedding = np.asarray(embed_query_text(listing_text, output_dimensionality=artifact.embedding_dim), dtype=float)
    mode_score = scan.risk_score if mode == "final" and scan.risk_score is not None else None
    projected = project_embedding(
        artifact=artifact,
        point_id=scan_id,
        label="current",
        embedding=query_embedding,
        mode_score=mode_score,
        metadata={"scan_id": scan_id},
    )
    final_score_source = "scan_final_risk_score" if mode_score is not None else "scan_embedding_score"

    return RiskMapPoint(
        case_id=scan_id,
        label="current",
        score=round(projected.score, 6),
        x=projected.coordinates.x3d if dim == 3 else projected.coordinates.x2d,
        y=projected.coordinates.y3d if dim == 3 else projected.coordinates.y2d,
        z=projected.coordinates.z3d if dim == 3 else None,
        embedding_risk_score=round(projected.embedding_risk_score, 6),
        final_score_source=final_score_source,
        title=exchange.outbound_payload.page_title,
        platform=exchange.outbound_payload.platform,
        summary=scan.summary,
    )


def build_scan_projection_response(*, scan_id: str, mode: str) -> ScanRiskProjectionResponse | None:
    """Return current scan projection using the saved risk-space artifact."""
    exchange = db_store.get_pipeline_exchange(scan_id)
    scan = db_store.get_scan(scan_id)
    if exchange is None or scan is None:
        return None

    artifact = load_or_train_active_artifact()
    listing_text = build_listing_text(exchange.outbound_payload)
    query_embedding = np.asarray(embed_query_text(listing_text, output_dimensionality=artifact.embedding_dim), dtype=float)
    final_score = scan.risk_score if scan.risk_score is not None else None
    projected = project_embedding(
        artifact=artifact,
        point_id=scan_id,
        label="current",
        embedding=query_embedding,
        mode_score=final_score if mode == "final" else None,
        metadata={"scan_id": scan_id},
    )
    risk_score = projected.risk_score
    if risk_score is None:
        raise RiskSpaceUnavailableError("scan projection risk score missing")

    resolved_final = float(final_score if final_score is not None else risk_score.embedding_risk_score)
    return ScanRiskProjectionResponse(
        scan_id=scan_id,
        model_version=artifact.model_version,
        mode=mode,  # type: ignore[arg-type]
        embedding_risk_score=round(risk_score.embedding_risk_score, 6),
        final_risk_score=round(resolved_final, 6),
        risk_points=scan.risk_points if scan.risk_points is not None else round(resolved_final * 100),
        risk_level=scan.risk_level or risk_level_from_score(resolved_final),
        x2d=projected.coordinates.x2d,
        y2d=projected.coordinates.y2d,
        x3d=projected.coordinates.x3d,
        y3d=projected.coordinates.y3d,
        z3d=projected.coordinates.z3d,
        prototype_cosines=risk_score.prototype_cosines,
        top_neighbors=[
            RiskMapNeighbor(
                case_id=neighbor.case_id,
                label=neighbor.label,
                cosine_similarity=neighbor.cosine_similarity,
                weighted_contribution=neighbor.weighted_contribution,
                title=neighbor.metadata.get("title"),
                platform=neighbor.metadata.get("platform"),
            )
            for neighbor in risk_score.top_neighbors
        ],
        score_breakdown={
            "calibrated_pls_score": round(risk_score.calibrated_pls_score, 6),
            "prototype_score": round(risk_score.prototype_score, 6),
            "neighbor_score": round(risk_score.neighbor_score, 6),
            "confidence": risk_score.confidence,
        },
        projection_metadata={
            "x_axis": "final_risk_score" if mode == "final" else "embedding_risk_score",
            "y_axis": "residual_component_1",
            "z_axis": "residual_component_2",
            "score_aligned": True,
            "reducer": artifact.residual_reducer_type,
            "clipped": projected.coordinates.clipped,
        },
        warnings=artifact.warnings + risk_score.warnings,
    )


def embedding_score_for_payload(payload: PipelineOutboundPayload) -> tuple[RiskSpaceScore | None, RiskSpaceArtifact | None, list[str]]:
    """Convenience wrapper for scan processing."""
    return score_listing_text(build_listing_text(payload))
