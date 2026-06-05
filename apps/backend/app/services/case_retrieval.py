"""Retrieve similar imported cases for scan results."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from app.db.models import Case, CaseChunk
from app.db.session import SessionLocal
from app.schemas.scan import SimilarCase


TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣]{2,}")
MAX_CANDIDATE_CHUNKS = 500


def search_similar_cases_for_text(query_text: str, top_k: int = 3) -> list[SimilarCase]:
    """Return top-k imported cases using deterministic lexical similarity."""
    query_text = normalize_text(query_text)
    if not query_text:
        return []

    query_tokens = set(tokenize(query_text))
    matches: list[tuple[float, CaseChunk, Case]] = []

    with SessionLocal() as db:
        for chunk, case in _load_candidate_chunks(db):
            chunk_text = normalize_text(chunk.chunk_text)
            score = score_similarity(query_text, query_tokens, chunk_text)
            if score <= 0:
                continue
            matches.append((score, chunk, case))

    matches.sort(key=lambda item: item[0], reverse=True)
    deduped: list[SimilarCase] = []
    seen_case_ids: set[str] = set()

    for score, _chunk, case in matches:
        if case.case_id in seen_case_ids:
            continue
        seen_case_ids.add(case.case_id)
        deduped.append(
            SimilarCase(
                case_id=case.case_id,
                score=round(min(score, 1.0), 6),
                summary=case.summary or case.title or case.body[:160],
            )
        )
        if len(deduped) >= top_k:
            break

    return deduped


def _load_candidate_chunks(db: Session) -> list[tuple[CaseChunk, Case]]:
    return (
        db.query(CaseChunk, Case)
        .join(Case, CaseChunk.case_id == Case.case_id)
        .order_by(Case.created_at.desc(), CaseChunk.chunk_order.asc())
        .limit(MAX_CANDIDATE_CHUNKS)
        .all()
    )


def normalize_text(text: str) -> str:
    return " ".join((text or "").lower().split())


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text or "")


def score_similarity(query_text: str, query_tokens: set[str], candidate_text: str) -> float:
    candidate_tokens = set(tokenize(candidate_text))
    if not candidate_tokens:
        return 0.0

    overlap = len(query_tokens & candidate_tokens) / max(len(query_tokens), 1)
    sequence_ratio = SequenceMatcher(None, query_text[:800], candidate_text[:800]).ratio()
    return (overlap * 0.7) + (sequence_ratio * 0.3)
