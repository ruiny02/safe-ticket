"""Train the supervised risk-aware PLS embedding model."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np
from sklearn.cross_decomposition import PLSRegression
from sklearn.decomposition import PCA
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split

from app.services.risk_space.artifact_io import RiskSpaceArtifact, new_model_version, save_artifact
from app.services.risk_space.cosine_scoring import (
    DEFAULT_SCORE_WEIGHTS,
    MinMaxCalibrator,
    build_prototypes,
    score_query_in_artifact,
)
from app.services.risk_space.data_loader import RiskSpaceDataset, load_case_embedding_dataset, l2_normalize_matrix


PCA_CANDIDATES: tuple[int | None, ...] = (None, 64, 128)
WEIGHT_CANDIDATES = (
    {"pls": 1.00, "prototype": 0.00, "neighbor": 0.00},
    {"pls": 0.90, "prototype": 0.05, "neighbor": 0.05},
    {"pls": 0.80, "prototype": 0.10, "neighbor": 0.10},
    {"pls": 0.70, "prototype": 0.15, "neighbor": 0.15},
)
ACTIVE_SCORE_WEIGHTS = {"pls": 0.70, "prototype": 0.15, "neighbor": 0.15}
TAU_CANDIDATES = (0.05, 0.10, 0.15, 0.20)
ACTIVE_PLS_COMPONENTS = 7
CandidateMode = Literal["full", "active"]


@dataclass(frozen=True)
class CandidateConfig:
    """One evaluated model configuration."""

    pca_components: int | None
    pls_components: int
    score_weights: dict[str, float]
    scoring_variant: str
    component_weights: tuple[float, ...]
    prototype_strategy: str
    neighbor_strategy: str
    risk_axis_tau: float
    diagnostic_only: bool = False

    @property
    def preprocessor_type(self) -> str:
        return "pca" if self.pca_components else "none"


def train_and_save_active_artifact(
    *,
    reducer: str = "pca",
    dry_run: bool = False,
    candidate_mode: CandidateMode = "full",
) -> tuple[RiskSpaceArtifact, dict[str, Any]]:
    """Train the best available artifact and save it as active unless dry-run."""
    dataset = load_case_embedding_dataset()
    artifact, report = train_risk_space_model(dataset, reducer=reducer, candidate_mode=candidate_mode)
    if not dry_run:
        save_artifact(artifact, activate=True)
    return artifact, report


def train_risk_space_model(
    dataset: RiskSpaceDataset,
    *,
    reducer: str = "pca",
    candidate_mode: CandidateMode = "full",
) -> tuple[RiskSpaceArtifact, dict[str, Any]]:
    """Train, evaluate, refit, and build a risk-space artifact from DB embeddings."""
    if dataset.x_raw.shape[0] == 0:
        raise ValueError("no eligible case embeddings found")

    warnings = list(dataset.warnings)
    if len(set(dataset.labels_str)) < 2:
        warnings.append("low_confidence_less_than_two_label_groups")
    diagnostics = _dataset_diagnostics(dataset)
    warnings.extend(diagnostics["leakage_warnings"])
    warnings.extend(diagnostics["duplicate_group_warnings"])

    train_indices, val_indices = _split_indices(dataset)
    candidate_results: list[dict[str, Any]] = []
    best_config: CandidateConfig | None = None
    best_score = -float("inf")

    if candidate_mode == "active":
        best_config = _active_candidate_config(dataset, train_indices)
        candidate_results.append(_candidate_result_stub(best_config))
    else:
        for config in _candidate_configs(dataset, train_indices):
            result = _evaluate_candidate(dataset, train_indices, val_indices, config)
            candidate_results.append(result)
            selection_score = _selection_score(result)
            if selection_score > best_score:
                best_score = selection_score
                best_config = config

    if best_config is None:
        best_config = CandidateConfig(
            pca_components=None,
            pls_components=max(1, min(2, dataset.x_raw.shape[0] - 1, dataset.x_raw.shape[1])),
            score_weights=ACTIVE_SCORE_WEIGHTS,
            scoring_variant="fallback_pls_axis",
            component_weights=(1.0,),
            prototype_strategy="risk_axis_centroid_distance",
            neighbor_strategy="risk_axis_density",
            risk_axis_tau=0.10,
        )
        warnings.append("fallback_default_candidate_used")

    artifact = _fit_final_artifact(
        dataset,
        best_config,
        reducer=reducer,
        warnings=warnings,
        include_top_k_purity=candidate_mode == "full",
    )
    report = {
        "sample_counts": dataset.sample_counts,
        "embedding_dim": dataset.embedding_dim,
        "candidate_results": candidate_results,
        "diagnostic_baselines": {
            result["scoring_variant"]: result
            for result in candidate_results
            if result.get("diagnostic_only")
        },
        "selected_candidate": {
            "preprocessor_type": best_config.preprocessor_type,
            "pca_components": best_config.pca_components,
            "pls_components": best_config.pls_components,
            "score_weights": best_config.score_weights,
            "scoring_variant": best_config.scoring_variant,
            "component_weights": artifact.component_weights,
            "prototype_strategy": best_config.prototype_strategy,
            "neighbor_strategy": best_config.neighbor_strategy,
            "risk_axis_tau": best_config.risk_axis_tau,
        },
        "diagnostics": diagnostics,
        "metrics": artifact.metrics,
        "warnings": artifact.warnings,
    }
    return artifact, report


def _split_indices(dataset: RiskSpaceDataset) -> tuple[np.ndarray, np.ndarray]:
    indices = np.arange(dataset.x_raw.shape[0])
    class_counts = {label: dataset.labels_str.count(label) for label in set(dataset.labels_str)}
    if len(indices) >= 6 and len(class_counts) >= 2 and min(class_counts.values()) >= 2:
        val_size = max(math.ceil(len(indices) * 0.25), len(class_counts))
        if len(indices) - val_size < len(class_counts):
            return indices, indices
        train, val = train_test_split(
            indices,
            test_size=val_size,
            random_state=42,
            stratify=dataset.labels_str,
        )
        return np.asarray(train, dtype=int), np.asarray(val, dtype=int)
    return indices, indices


def _candidate_configs(dataset: RiskSpaceDataset, train_indices: np.ndarray) -> list[CandidateConfig]:
    configs: list[CandidateConfig] = []
    n_train = len(train_indices)
    embedding_dim = dataset.x_raw.shape[1]
    for requested_pca in PCA_CANDIDATES:
        if requested_pca is None:
            preprocessed_dim = embedding_dim
            pca_components = None
        else:
            max_pca = min(requested_pca, n_train - 1, embedding_dim)
            if max_pca < 2:
                continue
            preprocessed_dim = max_pca
            pca_components = max_pca
        for weights in WEIGHT_CANDIDATES:
            configs.append(
                CandidateConfig(
                    pca_components=pca_components,
                    pls_components=1,
                    score_weights=weights,
                    scoring_variant="pls_axis_risk_density",
                    component_weights=(1.0,),
                    prototype_strategy="risk_axis_centroid_distance",
                    neighbor_strategy="risk_axis_density",
                    risk_axis_tau=0.10,
                )
            )
        for tau in TAU_CANDIDATES:
            configs.append(
                CandidateConfig(
                    pca_components=pca_components,
                    pls_components=1,
                    score_weights=ACTIVE_SCORE_WEIGHTS,
                    scoring_variant=f"pls_axis_risk_density_tau_{tau}",
                    component_weights=(1.0,),
                    prototype_strategy="risk_axis_centroid_distance",
                    neighbor_strategy="risk_axis_density",
                    risk_axis_tau=tau,
                )
            )
        bounded_pls7 = min(ACTIVE_PLS_COMPONENTS, n_train - 2, preprocessed_dim)
        if pca_components is None and bounded_pls7 >= 2:
            configs.append(
                CandidateConfig(
                    pca_components=None,
                    pls_components=bounded_pls7,
                    score_weights=ACTIVE_SCORE_WEIGHTS,
                    scoring_variant="weighted_pls7_cosine",
                    component_weights=(),
                    prototype_strategy="weighted_low_dim_cosine",
                    neighbor_strategy="weighted_low_dim_cosine",
                    risk_axis_tau=0.10,
                )
            )
        for requested_pls, component_weights, variant in (
            (3, (1.0, 0.20, 0.20), "weighted_pls3_cosine"),
            (5, (1.0, 0.15, 0.10, 0.08, 0.08), "weighted_pls5_cosine"),
        ):
            bounded = min(requested_pls, n_train - 2, preprocessed_dim)
            if bounded < 2:
                continue
            for weights in WEIGHT_CANDIDATES:
                configs.append(
                    CandidateConfig(
                        pca_components=pca_components,
                        pls_components=bounded,
                        score_weights=weights,
                        scoring_variant=variant,
                        component_weights=component_weights[:bounded],
                        prototype_strategy="weighted_low_dim_cosine",
                        neighbor_strategy="weighted_low_dim_cosine",
                        risk_axis_tau=0.10,
                    )
                )
        bounded_full = min(16, n_train - 2, preprocessed_dim)
        if bounded_full >= 2:
            configs.append(
                CandidateConfig(
                    pca_components=pca_components,
                    pls_components=bounded_full,
                    score_weights={"pls": 0.0, "prototype": 0.5, "neighbor": 0.5},
                    scoring_variant="full_pls_16d_cosine",
                    component_weights=tuple([1.0] * bounded_full),
                    prototype_strategy="weighted_low_dim_cosine",
                    neighbor_strategy="weighted_low_dim_cosine",
                    risk_axis_tau=0.10,
                    diagnostic_only=True,
                )
            )
    return configs


def _active_candidate_config(dataset: RiskSpaceDataset, train_indices: np.ndarray) -> CandidateConfig:
    """Return the service-policy scorer without running the full diagnostic search."""
    n_train = len(train_indices)
    embedding_dim = dataset.x_raw.shape[1]
    bounded_pls7 = min(ACTIVE_PLS_COMPONENTS, n_train - 2, embedding_dim)
    if bounded_pls7 >= 2:
        return CandidateConfig(
            pca_components=None,
            pls_components=bounded_pls7,
            score_weights=ACTIVE_SCORE_WEIGHTS,
            scoring_variant="weighted_pls7_cosine",
            component_weights=(),
            prototype_strategy="weighted_low_dim_cosine",
            neighbor_strategy="weighted_low_dim_cosine",
            risk_axis_tau=0.10,
        )

    return CandidateConfig(
        pca_components=None,
        pls_components=max(1, min(1, n_train - 1, embedding_dim)),
        score_weights=ACTIVE_SCORE_WEIGHTS,
        scoring_variant="pls_axis_risk_density",
        component_weights=(1.0,),
        prototype_strategy="risk_axis_centroid_distance",
        neighbor_strategy="risk_axis_density",
        risk_axis_tau=0.10,
    )


def _candidate_result_stub(config: CandidateConfig) -> dict[str, Any]:
    """Return lightweight report metadata for runtime active training."""
    return {
        "preprocessor_type": config.preprocessor_type,
        "pca_components": config.pca_components,
        "pls_components": config.pls_components,
        "score_weights": config.score_weights,
        "scoring_variant": config.scoring_variant,
        "component_weights": list(config.component_weights),
        "prototype_strategy": config.prototype_strategy,
        "neighbor_strategy": config.neighbor_strategy,
        "risk_axis_tau": config.risk_axis_tau,
        "diagnostic_only": config.diagnostic_only,
        "runtime_active_config": True,
    }


def _evaluate_candidate(
    dataset: RiskSpaceDataset,
    train_indices: np.ndarray,
    val_indices: np.ndarray,
    config: CandidateConfig,
) -> dict[str, Any]:
    try:
        artifact = _fit_artifact_for_indices(dataset, train_indices, config, reducer="pca", model_version="candidate")
        scores = [
            score_query_in_artifact(
                artifact=artifact,
                query_embedding=dataset.x_raw[index],
                exclude_case_id=dataset.case_ids[index],
            ).embedding_risk_score
            for index in val_indices
        ]
        y_val = dataset.y[val_indices]
        labels_val = [dataset.labels_str[index] for index in val_indices]
        class_means = _class_mean_scores(scores, labels_val)
        return {
            "preprocessor_type": config.preprocessor_type,
            "pca_components": config.pca_components,
            "pls_components": config.pls_components,
            "score_weights": config.score_weights,
            "scoring_variant": config.scoring_variant,
            "component_weights": list(config.component_weights),
            "prototype_strategy": config.prototype_strategy,
            "neighbor_strategy": config.neighbor_strategy,
            "risk_axis_tau": config.risk_axis_tau,
            "diagnostic_only": config.diagnostic_only,
            "ordinal_spearman": _safe_spearman(scores, y_val),
            "fraud_vs_nonfraud_roc_auc": _safe_roc_auc(scores, labels_val),
            "fraud_vs_nonfraud_average_precision": _safe_average_precision(scores, labels_val),
            "mae_to_label_value": _safe_mae(scores, y_val),
            "class_mean_scores": class_means,
            "class_mean_ordered": _class_means_ordered(class_means),
            "top_k_purity": _top_k_purity(artifact),
            "warnings": artifact.warnings,
        }
    except Exception as exc:
        return {
            "preprocessor_type": config.preprocessor_type,
            "pca_components": config.pca_components,
            "pls_components": config.pls_components,
            "score_weights": config.score_weights,
            "scoring_variant": config.scoring_variant,
            "component_weights": list(config.component_weights),
            "prototype_strategy": config.prototype_strategy,
            "neighbor_strategy": config.neighbor_strategy,
            "risk_axis_tau": config.risk_axis_tau,
            "diagnostic_only": config.diagnostic_only,
            "failed": True,
            "error": str(exc),
        }


def _fit_final_artifact(
    dataset: RiskSpaceDataset,
    config: CandidateConfig,
    *,
    reducer: str,
    warnings: list[str],
    include_top_k_purity: bool = True,
) -> RiskSpaceArtifact:
    artifact = _fit_artifact_for_indices(
        dataset,
        np.arange(dataset.x_raw.shape[0]),
        config,
        reducer=reducer,
        model_version=new_model_version(),
    )
    artifact.warnings.extend(warnings)
    artifact.metrics = _final_metrics(artifact, dataset, include_top_k_purity=include_top_k_purity)
    return artifact


def _fit_artifact_for_indices(
    dataset: RiskSpaceDataset,
    indices: np.ndarray,
    config: CandidateConfig,
    *,
    reducer: str,
    model_version: str,
) -> RiskSpaceArtifact:
    x_train = dataset.x_raw[indices]
    y_train = dataset.y[indices]
    labels_train = [dataset.labels_str[index] for index in indices]

    pca = None
    x_preprocessed = x_train
    if config.pca_components is not None:
        pca = PCA(n_components=config.pca_components, whiten=False, random_state=42)
        x_preprocessed = pca.fit_transform(x_train)

    pls_components = max(1, min(config.pls_components, x_preprocessed.shape[0] - 1, x_preprocessed.shape[1]))
    pls = PLSRegression(n_components=pls_components, scale=True, max_iter=500, tol=1e-6)
    pls.fit(x_preprocessed, y_train)
    historical_z = np.asarray(pls.transform(x_preprocessed), dtype=float)
    if config.scoring_variant == "weighted_pls7_cosine":
        calibrator = MinMaxCalibrator.fit(historical_z[:, 0])
        historical_axis_scores = calibrator.transform(historical_z[:, 0])
    else:
        raw_scores = np.asarray(pls.predict(x_preprocessed), dtype=float).reshape(-1)
        calibrator = MinMaxCalibrator.fit(raw_scores)
        historical_axis_scores = calibrator.transform(raw_scores)
    component_signs = _component_signs_by_risk(historical_z, y_train)
    historical_z = historical_z * component_signs
    if config.scoring_variant == "weighted_pls7_cosine":
        calibrator = MinMaxCalibrator.fit(historical_z[:, 0])
        historical_axis_scores = calibrator.transform(historical_z[:, 0])
    resolved_component_weights = _resolve_component_weights(config, historical_z, y_train)
    prototype_axis_centroids = _axis_centroids(historical_axis_scores, labels_train)
    weighted_historical_z = l2_normalize_matrix(historical_z * _component_weights(tuple(resolved_component_weights), historical_z.shape[1]))
    prototypes, prototype_warnings = build_prototypes(weighted_historical_z, y_train, labels_train)

    partial = RiskSpaceArtifact(
        model_version=model_version,
        created_at=datetime.now(UTC).isoformat(),
        embedding_dim=dataset.embedding_dim,
        preprocessor_type=config.preprocessor_type,
        pca=pca,
        pls=pls,
        calibrator=calibrator,
        prototype_vectors=prototypes,
        historical_case_ids=[dataset.case_ids[index] for index in indices],
        historical_z=historical_z,
        historical_y=y_train,
        historical_labels=[dataset.labels_str[index] for index in indices],
        historical_x_raw=x_train,
        historical_metadata=[dataset.metadata[index] for index in indices],
        score_weights=config.score_weights,
        prototype_temperature=8.0,
        neighbor_temperature=8.0,
        top_k=max(1, min(10, len(indices) - 1)),
        residual_coef=np.zeros(historical_z.shape[1]),
        residual_intercept=np.zeros(historical_z.shape[1]),
        residual_reducer_type="pca",
        residual_reducer=None,
        normalization={"y_min": 0.0, "y_max": 1.0, "z_min": 0.0, "z_max": 1.0},
        scoring_strategy=(
            "pls1_primary_pls7_cosine_v1"
            if config.scoring_variant == "weighted_pls7_cosine"
            else "pls_axis_primary_v1"
        ),
        scoring_variant=config.scoring_variant,
        component_weights=list(resolved_component_weights),
        prototype_strategy=config.prototype_strategy,
        neighbor_strategy=config.neighbor_strategy,
        risk_axis_tau=config.risk_axis_tau,
        historical_axis_scores=historical_axis_scores,
        prototype_axis_centroids=prototype_axis_centroids,
        diagnostics={
            "diagnostic_only": config.diagnostic_only,
            "component_signs": [float(value) for value in component_signs],
        },
        warnings=prototype_warnings,
    )
    scores = np.asarray(
        [
            score_query_in_artifact(
                artifact=partial,
                query_embedding=x_train[row],
                exclude_case_id=partial.historical_case_ids[row],
            ).embedding_risk_score
            for row in range(x_train.shape[0])
        ],
        dtype=float,
    )
    residual_coef, residual_intercept, residual_matrix = _residualize(historical_z, scores)
    reducer_object, reducer_type, normalization, reducer_warnings = _fit_residual_reducer(
        residual_matrix,
        reducer=reducer,
    )
    partial.residual_coef = residual_coef
    partial.residual_intercept = residual_intercept
    partial.residual_reducer = reducer_object
    partial.residual_reducer_type = reducer_type
    partial.normalization = normalization
    partial.warnings.extend(reducer_warnings)
    return partial


def _residualize(z: np.ndarray, scores: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    coef = np.zeros(z.shape[1], dtype=float)
    intercept = np.zeros(z.shape[1], dtype=float)
    residual = np.zeros_like(z, dtype=float)
    design = np.vstack([scores, np.ones_like(scores)]).T
    for column in range(z.shape[1]):
        coef[column], intercept[column] = np.linalg.lstsq(design, z[:, column], rcond=None)[0]
        residual[:, column] = z[:, column] - (coef[column] * scores + intercept[column])
    return coef, intercept, residual


def _fit_residual_reducer(residual_matrix: np.ndarray, *, reducer: str) -> tuple[Any, str, dict[str, float], list[str]]:
    warnings: list[str] = []
    if residual_matrix.shape[0] < 2:
        warnings.append("residual_reducer_insufficient_samples")
        normalization = {"y_min": 0.0, "y_max": 1.0, "z_min": 0.0, "z_max": 1.0}
        return None, "none", normalization, warnings

    if reducer == "umap" and residual_matrix.shape[0] >= 10:
        try:
            from umap import UMAP

            reducer_object: Any = UMAP(
                n_components=2,
                n_neighbors=max(2, min(15, residual_matrix.shape[0] - 1)),
                min_dist=0.25,
                metric="euclidean",
                init="random",
                random_state=42,
            )
            reduced = np.asarray(reducer_object.fit_transform(residual_matrix), dtype=float)
            reducer_type = "umap"
        except Exception as exc:
            warnings.append(f"residual_umap_fallback:{exc}")
            reducer_object, reduced, reducer_type = _fit_residual_pca(residual_matrix)
    else:
        reducer_object, reduced, reducer_type = _fit_residual_pca(residual_matrix)

    y_values = reduced[:, 0]
    z_values = reduced[:, 1] if reduced.shape[1] > 1 else np.zeros_like(y_values)
    return (
        reducer_object,
        reducer_type,
        {
            "y_min": float(np.min(y_values)),
            "y_max": float(np.max(y_values)),
            "z_min": float(np.min(z_values)),
            "z_max": float(np.max(z_values)),
        },
        warnings,
    )


def _fit_residual_pca(residual_matrix: np.ndarray) -> tuple[PCA, np.ndarray, str]:
    components = max(1, min(2, residual_matrix.shape[0] - 1, residual_matrix.shape[1]))
    reducer = PCA(n_components=components, whiten=False, random_state=42)
    reduced = reducer.fit_transform(residual_matrix)
    if reduced.shape[1] == 1:
        reduced = np.hstack([reduced, np.zeros((reduced.shape[0], 1))])
    return reducer, reduced, "pca"


def _axis_centroids(axis_scores: np.ndarray, labels: list[str]) -> dict[str, float]:
    centroids: dict[str, float] = {}
    for label in ("safe", "borderline", "fraud"):
        mask = np.asarray([item == label for item in labels], dtype=bool)
        if np.any(mask):
            centroids[label] = float(np.mean(axis_scores[mask]))
    return centroids


def _component_weights(configured: tuple[float, ...], dim: int) -> np.ndarray:
    values = list(configured)
    if not values:
        values = [1.0]
    if len(values) < dim:
        values.extend([0.0] * (dim - len(values)))
    return np.asarray(values[:dim], dtype=float)


def _resolve_component_weights(config: CandidateConfig, historical_z: np.ndarray, y: np.ndarray) -> list[float]:
    """Return configured or risk-explained PLS component weights."""
    if config.component_weights:
        return list(config.component_weights)
    cumulative = _component_y_cumulative_explained(historical_z, y, historical_z.shape[1])
    increments = np.diff(np.asarray([0.0, *cumulative], dtype=float))
    weights = np.sqrt(np.clip(increments, 1e-6, None))
    max_weight = float(np.max(weights)) if weights.size else 1.0
    if np.isclose(max_weight, 0.0):
        return [1.0] + [0.0] * max(0, historical_z.shape[1] - 1)
    return [round(float(weight / max_weight), 6) for weight in weights]


def _component_y_cumulative_explained(z: np.ndarray, y: np.ndarray, max_components: int) -> list[float]:
    """Approximate cumulative Y variance explained by the first k latent components."""
    y_array = np.asarray(y, dtype=float)
    total = float(np.sum((y_array - np.mean(y_array)) ** 2))
    if np.isclose(total, 0.0):
        return [0.0] * max_components

    cumulative: list[float] = []
    best = 0.0
    for count in range(1, max_components + 1):
        design = np.column_stack([np.asarray(z[:, :count], dtype=float), np.ones(z.shape[0])])
        coef, *_rest = np.linalg.lstsq(design, y_array, rcond=None)
        predicted = design @ coef
        explained = 1.0 - float(np.sum((y_array - predicted) ** 2)) / total
        best = max(best, float(np.clip(explained, 0.0, 1.0)))
        cumulative.append(round(best, 6))
    return cumulative


def _component_signs_by_risk(z: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Orient PLS components so higher values point toward higher risk."""
    signs = np.ones(z.shape[1], dtype=float)
    for column in range(z.shape[1]):
        if np.isclose(np.std(z[:, column]), 0.0) or np.isclose(np.std(y), 0.0):
            continue
        corr = np.corrcoef(z[:, column], y)[0, 1]
        if math.isfinite(float(corr)) and corr < 0:
            signs[column] = -1.0
    return signs


def _component_risk_correlations(z: np.ndarray, y: np.ndarray) -> list[float]:
    correlations: list[float] = []
    for column in range(z.shape[1]):
        if np.isclose(np.std(z[:, column]), 0.0) or np.isclose(np.std(y), 0.0):
            correlations.append(0.0)
            continue
        corr = np.corrcoef(z[:, column], y)[0, 1]
        correlations.append(round(float(corr), 6) if math.isfinite(float(corr)) else 0.0)
    return correlations


def _dataset_diagnostics(dataset: RiskSpaceDataset) -> dict[str, Any]:
    leakage_warnings = ["high_severity_embedding_source_verification_unavailable"]
    duplicate_group_warnings: list[str] = []

    source_url_counts: dict[str, int] = {}
    content_hash_counts: dict[str, int] = {}
    forbidden_terms = ("risk_level", "risk_score", "risk_tags", "evidence_items", "fraud", "safe", "위험", "사기", "안전")
    for metadata in dataset.metadata:
        source_url = str(metadata.get("source_url") or "")
        if source_url:
            source_url_counts[source_url] = source_url_counts.get(source_url, 0) + 1
        content_hash = str(metadata.get("content_hash") or "")
        if content_hash:
            content_hash_counts[content_hash] = content_hash_counts.get(content_hash, 0) + 1
        source_text = " ".join(
            str(metadata.get(key) or "")
            for key in ("title", "body_preview", "summary", "chunk_preview")
        ).lower()
        for term in forbidden_terms:
            if term.lower() in source_text:
                leakage_warnings.append(f"high_severity_possible_label_text_leakage:{term}")
                break

    duplicate_source_urls = sum(1 for count in source_url_counts.values() if count > 1)
    duplicate_content_hashes = sum(1 for count in content_hash_counts.values() if count > 1)
    if duplicate_source_urls:
        duplicate_group_warnings.append(f"duplicate_source_url_groups:{duplicate_source_urls}")
    if duplicate_content_hashes:
        duplicate_group_warnings.append(f"duplicate_content_hash_groups:{duplicate_content_hashes}")

    return {
        "leakage_warnings": sorted(set(leakage_warnings)),
        "duplicate_group_warnings": sorted(set(duplicate_group_warnings)),
        "duplicate_counts": {
            "source_url_groups": duplicate_source_urls,
            "content_hash_groups": duplicate_content_hashes,
        },
        "small_fraud_sample_warning": dataset.sample_counts.get("fraud", 0) < 30,
    }


def _final_metrics(
    artifact: RiskSpaceArtifact,
    dataset: RiskSpaceDataset,
    *,
    include_top_k_purity: bool = True,
) -> dict[str, Any]:
    scores = [
        score_query_in_artifact(artifact=artifact, query_embedding=row, exclude_case_id=case_id).embedding_risk_score
        for row, case_id in zip(dataset.x_raw, dataset.case_ids, strict=True)
    ]
    class_means = _class_mean_scores(scores, dataset.labels_str)
    component_correlations = _component_risk_correlations(artifact.historical_z, dataset.y)
    y_cumulative_explained = _component_y_cumulative_explained(
        artifact.historical_z,
        dataset.y,
        artifact.historical_z.shape[1],
    )
    y_incremental_explained = [
        round(float(right - left), 6)
        for left, right in zip([0.0, *y_cumulative_explained[:-1]], y_cumulative_explained, strict=True)
    ]
    return {
        "ordinal_spearman": _safe_spearman(scores, dataset.y),
        "fraud_vs_nonfraud_roc_auc": _safe_roc_auc(scores, dataset.labels_str),
        "fraud_vs_nonfraud_average_precision": _safe_average_precision(scores, dataset.labels_str),
        "mae_to_label_value": _safe_mae(scores, dataset.y),
        "class_mean_scores": class_means,
        "class_mean_ordered": _class_means_ordered(class_means),
        "top_k_purity": _top_k_purity(artifact) if include_top_k_purity else {},
        "component_risk_correlations": component_correlations,
        "pls_components": int(artifact.historical_z.shape[1]),
        "pls_y_cumulative_explained": y_cumulative_explained,
        "pls_y_incremental_explained": y_incremental_explained,
        "component_weights": artifact.component_weights,
        "selected_active_model_reason": (
            "Selected the service-policy scorer with 0.70 PLS1 calibrated score and "
            "0.15/0.15 weighted PLS7 prototype/neighbor cosine stabilizers."
        ),
        "risk_target_source": "case_risk_score_continuous_pls7_v2",
        "scoring_variant": artifact.scoring_variant,
        "scoring_strategy": artifact.scoring_strategy,
        "score_weights": artifact.score_weights,
    }


def _selection_score(result: dict[str, Any]) -> float:
    if result.get("failed") or result.get("diagnostic_only"):
        return -float("inf")
    if result.get("score_weights") != ACTIVE_SCORE_WEIGHTS:
        return -float("inf")
    if result.get("scoring_variant") != "weighted_pls7_cosine":
        return -float("inf")
    score = float(result.get("ordinal_spearman") or 0.0)
    score += float(result.get("fraud_vs_nonfraud_roc_auc") or 0.5) - 0.5
    score += 0.2 if result.get("class_mean_ordered") else -0.2
    score += float(result.get("top_k_purity", {}).get("k5", 0.0)) * 0.1
    score -= float(result.get("pls_components") or 1) * 0.01
    return score


def _class_mean_scores(scores: list[float] | np.ndarray, labels: list[str]) -> dict[str, float]:
    array = np.asarray(scores, dtype=float)
    means: dict[str, float] = {}
    for label in ("safe", "borderline", "fraud"):
        mask = np.asarray([item == label for item in labels], dtype=bool)
        if np.any(mask):
            means[label] = round(float(np.mean(array[mask])), 6)
    return means


def _class_means_ordered(means: dict[str, float]) -> bool:
    available = [means[label] for label in ("safe", "borderline", "fraud") if label in means]
    return all(left <= right for left, right in zip(available, available[1:]))


def _safe_spearman(scores: list[float] | np.ndarray, y: np.ndarray) -> float | None:
    if len(scores) < 2 or len(set(np.asarray(y).tolist())) < 2:
        return None
    score_ranks = np.argsort(np.argsort(np.asarray(scores, dtype=float)))
    label_ranks = np.argsort(np.argsort(y))
    correlation = np.corrcoef(score_ranks, label_ranks)[0, 1]
    return round(float(correlation), 6) if math.isfinite(float(correlation)) else None


def _safe_roc_auc(scores: list[float] | np.ndarray, labels: list[str]) -> float | None:
    target = np.asarray([label == "fraud" for label in labels], dtype=int)
    if len(set(target.tolist())) < 2:
        return None
    return round(float(roc_auc_score(target, scores)), 6)


def _safe_average_precision(scores: list[float] | np.ndarray, labels: list[str]) -> float | None:
    target = np.asarray([label == "fraud" for label in labels], dtype=int)
    if len(set(target.tolist())) < 2:
        return None
    return round(float(average_precision_score(target, scores)), 6)


def _safe_mae(scores: list[float] | np.ndarray, y: np.ndarray) -> float:
    return round(float(np.mean(np.abs(np.asarray(scores, dtype=float) - y))), 6)


def _top_k_purity(artifact: RiskSpaceArtifact) -> dict[str, float]:
    results: dict[str, float] = {}
    for k in (5, 10, 20):
        if len(artifact.historical_case_ids) <= 1:
            results[f"k{k}"] = 0.0
            continue
        matches = 0
        total = 0
        original_top_k = artifact.top_k
        artifact.top_k = max(1, min(k, len(artifact.historical_case_ids) - 1))
        for index, vector in enumerate(artifact.historical_x_raw):
            score = score_query_in_artifact(
                artifact=artifact,
                query_embedding=vector,
                exclude_case_id=artifact.historical_case_ids[index],
            )
            for neighbor in score.top_neighbors:
                matches += int(neighbor.label == artifact.historical_labels[index])
                total += 1
        artifact.top_k = original_top_k
        results[f"k{k}"] = round(matches / total, 6) if total else 0.0
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Safe Ticket risk-space PLS artifact.")
    parser.add_argument("--activate", action="store_true", help="Save trained artifact as active.")
    parser.add_argument("--dry-run", action="store_true", help="Train and print report without saving.")
    parser.add_argument("--reducer", choices=["pca", "umap"], default="pca")
    args = parser.parse_args()

    dataset = load_case_embedding_dataset()
    artifact, report = train_risk_space_model(dataset, reducer=args.reducer)
    if args.activate and not args.dry_run:
        save_artifact(artifact, activate=True)
    elif not args.dry_run:
        save_artifact(artifact, activate=False)

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
