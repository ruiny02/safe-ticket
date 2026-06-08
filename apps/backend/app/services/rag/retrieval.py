"""Embedding-based exact cosine retrieval for scan RAG context."""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db.models import Case, CaseChunk
from app.db.session import SessionLocal
from app.schemas.scan import SimilarCase
from app.services.rag.embeddings import QueryEmbeddingError, cosine_similarity, embed_query_text


MAX_CANDIDATE_CHUNKS = 1000


@dataclass(frozen=True)
class RetrievedCase:
    """One retrieved case plus the best matching chunk text."""

    case_id: str
    score: float
    summary: str
    matched_chunk: str
    risk_level: str | None
    risk_flags: list[str]

    def to_similar_case(self) -> SimilarCase:
        """Convert to the API-facing similar case schema."""
        return SimilarCase(
            case_id=self.case_id,
            score=round(min(max(self.score, 0.0), 1.0), 6),
            summary=self.summary,
            matched_chunk=self.matched_chunk,
            risk_level=self.risk_level,  # type: ignore[arg-type]
            risk_flags=self.risk_flags,
        )


def retrieve_similar_cases(query_text: str, top_k: int = 3) -> list[RetrievedCase]:
    """Return top-k de-duplicated cases by exact cosine similarity."""
    if not query_text.strip():
        return []

    matches: list[tuple[float, CaseChunk, Case]] = []
    with SessionLocal() as db:
        candidate_chunks = [
            (chunk, case, _coerce_embedding(chunk.embedding))
            for chunk, case in _load_candidate_chunks(db)
        ]

        embedding_dimensionality = _detect_embedding_dimensionality(
            candidate_embedding for _chunk, _case, candidate_embedding in candidate_chunks
        )
        if embedding_dimensionality is None:
            return []

        try:
            query_embedding = embed_query_text(query_text, output_dimensionality=embedding_dimensionality)
        except QueryEmbeddingError:
            return []

        for chunk, case, candidate_embedding in candidate_chunks:
            if len(candidate_embedding) != len(query_embedding):
                continue
            score = cosine_similarity(query_embedding, candidate_embedding)
            if score <= 0:
                continue
            matches.append((score, chunk, case))

    matches.sort(key=lambda item: item[0], reverse=True)
    results: list[RetrievedCase] = []
    seen_case_ids: set[str] = set()

    for score, chunk, case in matches:
        if case.case_id in seen_case_ids:
            continue
        seen_case_ids.add(case.case_id)
        results.append(
            RetrievedCase(
                case_id=case.case_id,
                score=score,
                summary=case.summary or case.title or case.body[:160],
                matched_chunk=chunk.chunk_text[:500],
                risk_level=case.risk_level,
                risk_flags=_coerce_string_list(case.risk_flags_json),
            )
        )
        if len(results) >= top_k:
            break

    return results


def _detect_embedding_dimensionality(candidate_embeddings: Iterable[list[float]]) -> int | None:
    """Use stored case_chunks.embedding dimensionality as the source of truth."""
    for candidate_embedding in candidate_embeddings:
        if candidate_embedding:
            return len(candidate_embedding)
    return None


def _load_candidate_chunks(db: Session) -> list[tuple[CaseChunk, Case]]:
    return (
        db.query(CaseChunk, Case)
        .join(Case, CaseChunk.case_id == Case.case_id)
        .order_by(Case.created_at.desc(), Case.case_id.asc(), CaseChunk.chunk_order.asc())
        .limit(MAX_CANDIDATE_CHUNKS)
        .all()
    )


def _coerce_embedding(value: object | None) -> list[float]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = [part.strip() for part in value.strip("[]").split(",") if part.strip()]
    if not isinstance(value, Iterable):
        return []
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return []


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
