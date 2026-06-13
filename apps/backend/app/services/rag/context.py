"""Build provider-neutral RAG context for scan analysis."""

from __future__ import annotations

from dataclasses import dataclass
import re

from app.schemas.external_lookup import ExternalLookupResponse
from app.schemas.scan import EvidenceItem, PipelineOutboundPayload, ScanCreateRequest, UserRiskContext
from app.services.rag.retrieval import RetrievedCase, retrieve_similar_cases
from app.services.rules.savings_account_rules import build_savings_account_evidence_items


@dataclass(frozen=True)
class SimilaritySummary:
    """Small retrieval summary used by scoring and prompts."""

    max_score: float
    average_score: float
    count: int


@dataclass(frozen=True)
class RAGContext:
    """All scan context shared by scoring, LLM copy, highlight generation, and chat."""

    scan_payload: ScanCreateRequest | PipelineOutboundPayload
    listing_text: str
    user_context: UserRiskContext
    external_lookup_results: list[ExternalLookupResponse]
    savings_account_signals: list[EvidenceItem]
    similar_cases_top3: list[RetrievedCase]
    similarity_summary: SimilaritySummary
    scoring_signals: dict[str, object]


def build_rag_context(
    *,
    scan_payload: ScanCreateRequest | PipelineOutboundPayload,
    external_lookup_results: list[ExternalLookupResponse],
    user_context: UserRiskContext | None = None,
) -> RAGContext:
    """Build reusable RAG context from scan text, lookups, rules, and retrieved cases."""
    resolved_user_context = user_context or UserRiskContext()
    listing_text = build_listing_text(scan_payload)
    savings_signals = build_savings_account_evidence_items(scan_payload.content_blocks)
    similar_cases = retrieve_similar_cases(listing_text, top_k=3)
    similarity_summary = _build_similarity_summary(similar_cases)
    external_positive = any(
        result.status == "completed" and result.risk_found is True
        for result in external_lookup_results
    )

    return RAGContext(
        scan_payload=scan_payload,
        listing_text=listing_text,
        user_context=resolved_user_context,
        external_lookup_results=external_lookup_results,
        savings_account_signals=savings_signals,
        similar_cases_top3=similar_cases,
        similarity_summary=similarity_summary,
        scoring_signals={
            "external_lookup_positive": external_positive,
            "has_savings_account_pattern": any(
                signal.reason_code == "bank_account_pattern" for signal in savings_signals
            ),
            "max_similarity_score": similarity_summary.max_score,
            "age_group": resolved_user_context.age_group,
            "trade_experience": resolved_user_context.trade_experience,
            "seller_review_count": extract_seller_review_count(scan_payload),
        },
    )


def build_listing_text(scan_payload: ScanCreateRequest | PipelineOutboundPayload) -> str:
    """Build the stable retrieval input boundary from title and content blocks."""
    block_text = "\n".join(block.text for block in scan_payload.content_blocks if block.text.strip())
    return "\n".join(
        part
        for part in [
            f"title: {scan_payload.page_title}",
            f"price: {scan_payload.price}",
            f"seller: {scan_payload.seller.nickname}",
            block_text,
        ]
        if part.strip()
    )


def extract_seller_review_count(scan_payload: ScanCreateRequest | PipelineOutboundPayload) -> int | None:
    """Extract marketplace review count from normalized frontend signals."""
    for signal in scan_payload.marketplace_signals:
        if signal.key != "review_count":
            continue
        match = re.search(r"\d[\d,]*", signal.value)
        if not match:
            continue
        return int(match.group(0).replace(",", ""))
    return None


def _build_similarity_summary(similar_cases: list[RetrievedCase]) -> SimilaritySummary:
    if not similar_cases:
        return SimilaritySummary(max_score=0.0, average_score=0.0, count=0)
    scores = [case.score for case in similar_cases]
    return SimilaritySummary(
        max_score=max(scores),
        average_score=sum(scores) / len(scores),
        count=len(scores),
    )
