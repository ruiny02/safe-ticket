"""Deterministic local embeddings for offline fraud-memory bootstrapping.

This provider is intentionally local and dependency-free. It lets the pipeline
produce an embedding-shaped dataset before the team decides on a hosted or
model-based embedding provider.
"""

from __future__ import annotations

import hashlib
import math
import re

DEFAULT_EMBEDDING_DIM = 128
DEFAULT_EMBEDDING_MODEL = "local-hashing-v1"
TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣_+#./-]+")


def embed_text(text: str, dim: int = DEFAULT_EMBEDDING_DIM) -> list[float]:
    """Convert text into a normalized hashing-vector embedding."""
    if dim <= 0:
        raise ValueError("embedding dimension must be positive")

    vector = [0.0] * dim
    tokens = tokenize(text)

    if not tokens:
        return vector

    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        weight = 1.0 + min(len(token), 20) / 20.0
        vector[index] += sign * weight

    return normalize_vector(vector)


def tokenize(text: str) -> list[str]:
    """Return normalized Korean/English/numeric tokens."""
    return [match.group(0).lower() for match in TOKEN_PATTERN.finditer(text or "")]


def normalize_vector(vector: list[float]) -> list[float]:
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude == 0:
        return vector
    return [round(value / magnitude, 8) for value in vector]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    """Return cosine similarity for already-normalized or raw vectors."""
    if not left or not right or len(left) != len(right):
        return 0.0

    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))

    if left_norm == 0 or right_norm == 0:
        return 0.0

    return dot / (left_norm * right_norm)
