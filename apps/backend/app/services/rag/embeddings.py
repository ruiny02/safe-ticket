"""Gemini query embeddings used for exact case RAG retrieval."""

from __future__ import annotations

import math

import httpx

from app.core.config import get_settings


GEMINI_EMBEDDING_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


class QueryEmbeddingError(RuntimeError):
    """Raised when a semantic query embedding cannot be generated."""


def embed_query_text(text: str, *, output_dimensionality: int) -> list[float]:
    """Generate a Gemini query embedding with the same dimension as stored case vectors."""
    if output_dimensionality <= 0:
        raise ValueError("output_dimensionality must be positive")
    if not text.strip():
        return []

    settings = get_settings()
    if not settings.gemini_api_key:
        raise QueryEmbeddingError("GEMINI_API_KEY is not configured for RAG retrieval.")

    model = settings.gemini_embedding_model
    request_url = f"{GEMINI_EMBEDDING_BASE_URL}/{model}:embedContent"
    request_body = {
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_QUERY",
        "outputDimensionality": output_dimensionality,
    }
    headers = {"Content-Type": "application/json", "x-goog-api-key": settings.gemini_api_key}

    try:
        with httpx.Client(timeout=settings.gemini_api_timeout_seconds) as client:
            response = client.post(request_url, headers=headers, json=request_body)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise QueryEmbeddingError(f"Gemini query embedding request failed: {exc}") from exc

    values = payload.get("embedding", {}).get("values") if isinstance(payload, dict) else None
    if not isinstance(values, list):
        raise QueryEmbeddingError("Gemini query embedding response did not contain values.")
    try:
        vector = [float(value) for value in values]
    except (TypeError, ValueError) as exc:
        raise QueryEmbeddingError("Gemini query embedding values were not numeric.") from exc
    if len(vector) != output_dimensionality:
        raise QueryEmbeddingError(
            f"Gemini query embedding dimension mismatch: expected {output_dimensionality}, got {len(vector)}."
        )

    return normalize_vector(vector)


def cosine_similarity(left: list[float], right: list[float]) -> float:
    """Return cosine similarity for two embedding vectors."""
    if not left or not right or len(left) != len(right):
        return 0.0

    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def normalize_vector(vector: list[float]) -> list[float]:
    """Normalize a vector to unit length."""
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude == 0:
        return vector
    return [round(value / magnitude, 8) for value in vector]
