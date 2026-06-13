"""Cosine scoring helpers in the supervised PLS latent risk space."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.services.risk_space.data_loader import VALUE_TO_LABEL, l2_normalize_matrix, l2_normalize_vector


DEFAULT_SCORE_WEIGHTS = {"pls": 0.70, "prototype": 0.15, "neighbor": 0.15}
LABEL_VALUES = {"safe": 0.0, "borderline": 0.5, "fraud": 1.0}


@dataclass(frozen=True)
class TopNeighbor:
    """A historical case neighbor in risk-aware latent space."""

    case_id: str
    label: str
    cosine_similarity: float
    weighted_contribution: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RiskSpaceScore:
    """Embedding-only score components for one query vector."""

    embedding_risk_score: float
    calibrated_pls_score: float
    prototype_score: float
    neighbor_score: float
    prototype_cosines: dict[str, float]
    prototype_probabilities: dict[str, float]
    top_neighbors: list[TopNeighbor]
    confidence: dict[str, float]
    warnings: list[str] = field(default_factory=list)


class MinMaxCalibrator:
    """Small serializable fallback calibrator for PLS raw predictions."""

    def __init__(self, low: float, high: float) -> None:
        self.low = float(low)
        self.high = float(high)

    @classmethod
    def fit(cls, values: np.ndarray) -> "MinMaxCalibrator":
        finite = np.asarray([float(value) for value in values if math.isfinite(float(value))], dtype=float)
        if finite.size == 0:
            return cls(0.0, 1.0)
        low = float(np.min(finite))
        high = float(np.max(finite))
        if math.isclose(low, high):
            high = low + 1.0
        return cls(low, high)

    def transform(self, values: np.ndarray) -> np.ndarray:
        array = np.asarray(values, dtype=float)
        scaled = (array - self.low) / max(self.high - self.low, 1e-12)
        return np.clip(scaled, 0.0, 1.0)


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    """Return cosine similarity between two vectors."""
    left_norm = l2_normalize_vector(np.asarray(left, dtype=float))
    right_norm = l2_normalize_vector(np.asarray(right, dtype=float))
    return float(np.dot(left_norm, right_norm))


def build_prototypes(z: np.ndarray, y: np.ndarray, labels: list[str] | None = None) -> tuple[dict[str, np.ndarray], list[str]]:
    """Build normalized ordinal class prototypes from latent vectors."""
    prototypes: dict[str, np.ndarray] = {}
    warnings: list[str] = []
    normalized_z = l2_normalize_matrix(z)

    for value, label in VALUE_TO_LABEL.items():
        if labels is None:
            mask = np.isclose(y, value)
        else:
            mask = np.asarray([item == label for item in labels], dtype=bool)
        if not np.any(mask):
            warnings.append(f"missing_prototype_class:{label}")
            continue
        prototypes[label] = l2_normalize_vector(np.mean(normalized_z[mask], axis=0))

    if "safe" not in prototypes or "fraud" not in prototypes:
        warnings.append("low_confidence_missing_safe_or_fraud_prototype")
    return prototypes, warnings


def score_query_in_artifact(
    *,
    artifact: Any,
    query_embedding: np.ndarray,
    exclude_case_id: str | None = None,
) -> RiskSpaceScore:
    """Project and score a query embedding with the saved risk-space artifact."""
    warnings: list[str] = []
    query_x = l2_normalize_vector(np.asarray(query_embedding, dtype=float)).reshape(1, -1)
    if query_x.shape[1] != artifact.embedding_dim:
        raise ValueError(f"embedding_dim_mismatch:{query_x.shape[1]}!={artifact.embedding_dim}")

    preprocessed = artifact.transform_preprocessor(query_x)
    query_z = np.asarray(artifact.pls.transform(preprocessed), dtype=float)[0]
    component_signs = np.asarray(
        getattr(artifact, "diagnostics", {}).get("component_signs") or [1.0] * len(query_z),
        dtype=float,
    )
    if component_signs.size < query_z.size:
        component_signs = np.pad(component_signs, (0, query_z.size - component_signs.size), constant_values=1.0)
    query_z = query_z * component_signs[: query_z.size]
    if getattr(artifact, "scoring_variant", "") == "weighted_pls7_cosine":
        # In the PLS7 policy, the main 0.70 score term intentionally uses only
        # component 1. Prototype and neighbor stabilizers use the full weighted
        # PLS7 vector below.
        calibrated_pls_score = float(artifact.calibrator.transform(np.asarray([query_z[0]], dtype=float))[0])
    else:
        raw_prediction = np.asarray(artifact.pls.predict(preprocessed), dtype=float).reshape(-1)
        calibrated_pls_score = float(artifact.calibrator.transform(raw_prediction)[0])

    prototype_strategy = getattr(artifact, "prototype_strategy", "risk_axis_centroid_distance")
    neighbor_strategy = getattr(artifact, "neighbor_strategy", "risk_axis_density")
    risk_axis_tau = float(getattr(artifact, "risk_axis_tau", 0.10) or 0.10)
    scoring_vector = _weighted_scoring_vector(artifact, query_z)

    if prototype_strategy == "risk_axis_centroid_distance":
        prototype_score, prototype_cosines, prototype_probabilities = _score_axis_prototypes(
            axis_score=calibrated_pls_score,
            centroids=getattr(artifact, "prototype_axis_centroids", {}) or {},
            tau=risk_axis_tau,
        )
    else:
        prototype_score, prototype_cosines, prototype_probabilities = _score_prototypes(
            query_z=scoring_vector,
            prototypes=artifact.prototype_vectors,
            temperature=artifact.prototype_temperature,
        )

    if neighbor_strategy == "risk_axis_density":
        neighbor_score, top_neighbors, neighbor_confidence = _score_axis_neighbors(
            axis_score=calibrated_pls_score,
            historical_axis_scores=getattr(artifact, "historical_axis_scores", np.asarray([], dtype=float)),
            historical_y=artifact.historical_y,
            historical_case_ids=artifact.historical_case_ids,
            historical_labels=artifact.historical_labels,
            historical_metadata=artifact.historical_metadata,
            top_k=artifact.top_k,
            tau=risk_axis_tau,
            exclude_case_id=exclude_case_id,
        )
    else:
        neighbor_score, top_neighbors, neighbor_confidence = _score_neighbors(
            query_z=scoring_vector,
            historical_z=_weighted_historical_z(artifact),
            historical_y=artifact.historical_y,
            historical_case_ids=artifact.historical_case_ids,
            historical_labels=artifact.historical_labels,
            historical_metadata=artifact.historical_metadata,
            top_k=artifact.top_k,
            temperature=artifact.neighbor_temperature,
            exclude_case_id=exclude_case_id,
        )

    if not top_neighbors:
        warnings.append("neighbor_score_unavailable")

    weights = artifact.score_weights or DEFAULT_SCORE_WEIGHTS
    embedding_risk_score = float(
        np.clip(
            weights.get("pls", 0.70) * calibrated_pls_score
            + weights.get("prototype", 0.15) * prototype_score
            + weights.get("neighbor", 0.15) * neighbor_score,
            0.0,
            1.0,
        )
    )
    neighbor_confidence.update(
        {
            "scoring_strategy": getattr(artifact, "scoring_strategy", "pls_axis_primary_v1"),
            "scoring_variant": getattr(artifact, "scoring_variant", "unknown"),
            "prototype_similarity_type": prototype_strategy,
            "neighbor_similarity_type": neighbor_strategy,
            "score_weight_pls": float(weights.get("pls", 0.70)),
            "score_weight_prototype": float(weights.get("prototype", 0.15)),
            "score_weight_neighbor": float(weights.get("neighbor", 0.15)),
        }
    )

    return RiskSpaceScore(
        embedding_risk_score=embedding_risk_score,
        calibrated_pls_score=calibrated_pls_score,
        prototype_score=prototype_score,
        neighbor_score=neighbor_score,
        prototype_cosines=prototype_cosines,
        prototype_probabilities=prototype_probabilities,
        top_neighbors=top_neighbors,
        confidence=neighbor_confidence,
        warnings=warnings,
    )


def _score_prototypes(
    *,
    query_z: np.ndarray,
    prototypes: dict[str, np.ndarray],
    temperature: float,
) -> tuple[float, dict[str, float], dict[str, float]]:
    if not prototypes:
        return 0.5, {}, {}

    labels = list(prototypes.keys())
    cosines = np.asarray([cosine_similarity(query_z, prototypes[label]) for label in labels], dtype=float)
    probabilities = _softmax(temperature * cosines)
    score = 0.0
    for label, probability in zip(labels, probabilities, strict=True):
        score += LABEL_VALUES.get(label, 0.5) * float(probability)

    return (
        float(np.clip(score, 0.0, 1.0)),
        {label: round(float(cosine), 6) for label, cosine in zip(labels, cosines, strict=True)},
        {label: round(float(probability), 6) for label, probability in zip(labels, probabilities, strict=True)},
    )


def _score_axis_prototypes(
    *,
    axis_score: float,
    centroids: dict[str, float],
    tau: float,
) -> tuple[float, dict[str, float], dict[str, float]]:
    if not centroids:
        return 0.5, {}, {}

    labels = list(centroids.keys())
    distances = np.asarray([abs(axis_score - float(centroids[label])) for label in labels], dtype=float)
    similarities = np.exp(-distances / max(tau, 1e-6))
    probabilities = similarities / max(float(np.sum(similarities)), 1e-12)
    score = 0.0
    for label, probability in zip(labels, probabilities, strict=True):
        score += LABEL_VALUES.get(label, 0.5) * float(probability)

    return (
        float(np.clip(score, 0.0, 1.0)),
        {label: round(float(1.0 - distance), 6) for label, distance in zip(labels, distances, strict=True)},
        {label: round(float(probability), 6) for label, probability in zip(labels, probabilities, strict=True)},
    )


def _score_axis_neighbors(
    *,
    axis_score: float,
    historical_axis_scores: np.ndarray,
    historical_y: np.ndarray,
    historical_case_ids: list[str],
    historical_labels: list[str],
    historical_metadata: list[dict[str, Any]],
    top_k: int,
    tau: float,
    exclude_case_id: str | None,
) -> tuple[float, list[TopNeighbor], dict[str, float]]:
    if historical_axis_scores.size == 0:
        return 0.5, [], {"valid_neighbors": 0.0}

    similarities = np.exp(-np.abs(np.asarray(historical_axis_scores, dtype=float) - axis_score) / max(tau, 1e-6))
    candidates: list[tuple[float, int]] = []
    for index, similarity in enumerate(similarities):
        if exclude_case_id and historical_case_ids[index] == exclude_case_id:
            continue
        candidates.append((float(similarity), index))
    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = candidates[: max(1, min(top_k, len(candidates)))]
    if not selected:
        return 0.5, [], {"valid_neighbors": 0.0}

    selected_similarities = np.asarray([similarity for similarity, _index in selected], dtype=float)
    weights = selected_similarities / max(float(np.sum(selected_similarities)), 1e-12)
    score = 0.0
    neighbors: list[TopNeighbor] = []
    for weight, (similarity, index) in zip(weights, selected, strict=True):
        label_value = float(historical_y[index])
        score += label_value * float(weight)
        neighbors.append(
            TopNeighbor(
                case_id=historical_case_ids[index],
                label=historical_labels[index],
                cosine_similarity=round(float(similarity), 6),
                weighted_contribution=round(float(label_value * weight), 6),
                metadata=historical_metadata[index],
            )
        )

    label_counts = Counter(neighbor.label for neighbor in neighbors)
    entropy = _entropy(np.asarray(list(label_counts.values()), dtype=float))
    sorted_weights = sorted((float(weight) for weight in weights), reverse=True)
    margin = sorted_weights[0] - sorted_weights[1] if len(sorted_weights) > 1 else sorted_weights[0]
    return (
        float(np.clip(score, 0.0, 1.0)),
        neighbors,
        {
            "max_risk_axis_similarity": round(float(np.max(selected_similarities)), 6),
            "mean_top_k_risk_axis_similarity": round(float(np.mean(selected_similarities)), 6),
            "label_entropy": round(float(entropy), 6),
            "valid_neighbors": float(len(neighbors)),
            "top_probability_margin": round(float(margin), 6),
        },
    )


def _score_neighbors(
    *,
    query_z: np.ndarray,
    historical_z: np.ndarray,
    historical_y: np.ndarray,
    historical_case_ids: list[str],
    historical_labels: list[str],
    historical_metadata: list[dict[str, Any]],
    top_k: int,
    temperature: float,
    exclude_case_id: str | None,
) -> tuple[float, list[TopNeighbor], dict[str, float]]:
    if historical_z.size == 0:
        return 0.5, [], {"valid_neighbors": 0.0}

    cosines = historical_z @ l2_normalize_vector(query_z)
    candidates: list[tuple[float, int]] = []
    for index, cosine in enumerate(cosines):
        if exclude_case_id and historical_case_ids[index] == exclude_case_id:
            continue
        candidates.append((float(cosine), index))
    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = candidates[: max(1, min(top_k, len(candidates)))]
    if not selected:
        return 0.5, [], {"valid_neighbors": 0.0}

    selected_cosines = np.asarray([cosine for cosine, _index in selected], dtype=float)
    weights = _softmax(temperature * selected_cosines)
    score = 0.0
    neighbors: list[TopNeighbor] = []
    for weight, (cosine, index) in zip(weights, selected, strict=True):
        label_value = float(historical_y[index])
        score += label_value * float(weight)
        neighbors.append(
            TopNeighbor(
                case_id=historical_case_ids[index],
                label=historical_labels[index],
                cosine_similarity=round(float(cosine), 6),
                weighted_contribution=round(float(label_value * weight), 6),
                metadata=historical_metadata[index],
            )
        )

    label_counts = Counter(neighbor.label for neighbor in neighbors)
    entropy = _entropy(np.asarray(list(label_counts.values()), dtype=float))
    sorted_weights = sorted((float(weight) for weight in weights), reverse=True)
    margin = sorted_weights[0] - sorted_weights[1] if len(sorted_weights) > 1 else sorted_weights[0]
    return (
        float(np.clip(score, 0.0, 1.0)),
        neighbors,
        {
            "max_cosine": round(float(np.max(selected_cosines)), 6),
            "mean_top_k_cosine": round(float(np.mean(selected_cosines)), 6),
            "label_entropy": round(float(entropy), 6),
            "valid_neighbors": float(len(neighbors)),
            "top_probability_margin": round(float(margin), 6),
        },
    )


def _weighted_scoring_vector(artifact: Any, query_z: np.ndarray) -> np.ndarray:
    return l2_normalize_vector(np.asarray(query_z, dtype=float) * _component_weights(artifact, len(query_z)))


def _weighted_historical_z(artifact: Any) -> np.ndarray:
    historical_z = np.asarray(artifact.historical_z, dtype=float)
    if historical_z.size == 0:
        return historical_z
    weights = _component_weights(artifact, historical_z.shape[1])
    return l2_normalize_matrix(historical_z * weights)


def _component_weights(artifact: Any, dim: int) -> np.ndarray:
    configured = list(getattr(artifact, "component_weights", []) or [])
    if not configured:
        configured = [1.0] + [0.0] * max(0, dim - 1)
    if len(configured) < dim:
        configured.extend([0.0] * (dim - len(configured)))
    return np.asarray(configured[:dim], dtype=float)


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values)
    exponents = np.exp(shifted)
    return exponents / np.sum(exponents)


def _entropy(counts: np.ndarray) -> float:
    if counts.size == 0:
        return 0.0
    probabilities = counts / np.sum(counts)
    return float(-np.sum(probabilities * np.log2(np.maximum(probabilities, 1e-12))))
