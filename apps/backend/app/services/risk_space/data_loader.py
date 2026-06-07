"""Load historical case embeddings for risk-aware supervised projection."""

from __future__ import annotations

import json
import hashlib
import math
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import numpy as np
from sqlalchemy.orm import selectinload

from app.db.models import Case
from app.db.session import SessionLocal


LABEL_TO_VALUE = {
    "safe": 0.0,
    "low": 0.0,
    "risk_low": 0.0,
    "borderline": 0.5,
    "medium": 0.5,
    "risk_medium": 0.5,
    "fraud": 1.0,
    "high": 1.0,
    "risk_high": 1.0,
}

VALUE_TO_LABEL = {
    0.0: "safe",
    0.5: "borderline",
    1.0: "fraud",
}


@dataclass(frozen=True)
class RiskSpaceDataset:
    """Case-level embedding dataset used by the supervised risk-space model."""

    case_ids: list[str]
    x_raw: np.ndarray
    labels_str: list[str]
    y: np.ndarray
    metadata: list[dict[str, Any]]
    embedding_dim: int
    warnings: list[str]

    @property
    def sample_counts(self) -> dict[str, int]:
        return dict(Counter(self.labels_str))


def load_case_embedding_dataset(limit: int | None = None) -> RiskSpaceDataset:
    """Load case_chunks.embedding from DB and aggregate them to case-level vectors.

    Training intentionally uses only persisted case embeddings and case labels.
    No external embedding API is called here.
    """
    with SessionLocal() as db:
        query = db.query(Case).options(selectinload(Case.chunks)).order_by(Case.case_id.asc())
        if limit is not None:
            query = query.limit(limit)
        cases = query.all()

    rows: list[tuple[str, np.ndarray, str, float, dict[str, Any]]] = []
    warnings: list[str] = []
    expected_dim: int | None = None

    for case in cases:
        label = _label_for_case(case)
        if label is None:
            warnings.append(f"skip_missing_label:{case.case_id}")
            continue
        target = _target_for_case(case, label)

        chunk_embeddings = [
            embedding
            for embedding in (_coerce_embedding(chunk.embedding) for chunk in case.chunks)
            if embedding is not None
        ]
        if not chunk_embeddings:
            warnings.append(f"skip_missing_embedding:{case.case_id}")
            continue

        first_dim = len(chunk_embeddings[0])
        aligned = [embedding for embedding in chunk_embeddings if len(embedding) == first_dim]
        if not aligned:
            warnings.append(f"skip_unaligned_chunks:{case.case_id}")
            continue

        if expected_dim is None:
            expected_dim = first_dim
        if first_dim != expected_dim:
            warnings.append(f"skip_embedding_dim_mismatch:{case.case_id}:{first_dim}!={expected_dim}")
            continue

        pooled = np.mean(np.asarray(aligned, dtype=float), axis=0)
        normalized = l2_normalize_vector(pooled)
        rows.append(
            (
                case.case_id,
                normalized,
                label,
                target,
                {
                    "title": case.title,
                    "body_preview": case.body[:240],
                    "chunk_preview": " ".join(chunk.chunk_text[:120] for chunk in case.chunks[:3]),
                    "content_hash": _content_hash(case.title or "", case.body),
                    "summary": case.summary,
                    "platform": case.platform_hint,
                    "source_url": case.source_url,
                    "risk_level": case.risk_level,
                    "risk_score": case.risk_score,
                    "risk_flags": _coerce_string_list(case.risk_flags_json),
                },
            )
        )

    if not rows:
        return RiskSpaceDataset(
            case_ids=[],
            x_raw=np.empty((0, 0)),
            labels_str=[],
            y=np.asarray([], dtype=float),
            metadata=[],
            embedding_dim=0,
            warnings=warnings or ["no_eligible_cases"],
        )

    case_ids, vectors, labels, targets, metadata = zip(*rows, strict=True)
    return RiskSpaceDataset(
        case_ids=list(case_ids),
        x_raw=np.vstack(vectors),
        labels_str=list(labels),
        y=np.asarray(targets, dtype=float),
        metadata=list(metadata),
        embedding_dim=len(vectors[0]),
        warnings=warnings,
    )


def l2_normalize_matrix(matrix: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    """Return row-wise L2-normalized matrix."""
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return matrix / np.maximum(norms, eps)


def l2_normalize_vector(vector: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    """Return a finite L2-normalized vector."""
    array = np.asarray(vector, dtype=float)
    if array.ndim != 1 or not np.all(np.isfinite(array)):
        raise ValueError("embedding vector must be one-dimensional and finite")
    norm = np.linalg.norm(array)
    return array / max(float(norm), eps)


def _label_for_case(case: Case) -> str | None:
    candidates = [case.label, case.risk_level]
    for value in candidates:
        normalized = str(value or "").strip().lower()
        if normalized in LABEL_TO_VALUE:
            return VALUE_TO_LABEL[LABEL_TO_VALUE[normalized]]
    return None


def _target_for_case(case: Case, label: str) -> float:
    if isinstance(case.risk_score, int | float) and math.isfinite(float(case.risk_score)):
        return float(np.clip(float(case.risk_score), 0.0, 1.0))
    return LABEL_TO_VALUE[label]


def _coerce_embedding(value: object | None) -> np.ndarray | None:
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
        vector = np.asarray([float(item) for item in value], dtype=float)
    except (TypeError, ValueError):
        return None
    if vector.size == 0 or any(not math.isfinite(float(item)) for item in vector):
        return None
    return vector


def _coerce_string_list(value: object | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return [value] if value else []
    if not isinstance(value, Iterable):
        return []
    return [str(item) for item in value if item]


def _content_hash(*parts: str) -> str:
    joined = "\n".join(part.strip() for part in parts if part.strip())
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]
