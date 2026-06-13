"""Tests for reusable RAG context, retrieval, and deterministic scoring."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from app.db.base import Base
from app.db.models import Case, CaseChunk
from app.db.session import SessionLocal, engine
from app.schemas.external_lookup import ExternalLookupResponse
from app.schemas.scan import ContentBlock, MarketplaceSignal, ScanCreateRequest, UserRiskContext
from app.services.rag import retrieval as retrieval_module
from app.services.rag import scoring as scoring_module
from app.services.rag.context import build_rag_context
from app.services.rag.retrieval import retrieve_similar_cases
from app.services.rag.scoring import score_rag_context
from app.services.risk_space.cosine_scoring import RiskSpaceScore


def reset_database() -> None:
    """Rebuild tables used by exact cosine retrieval tests."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def seed_case(case_id: str, text: str, risk_level: str = "high", embedding: list[float] | None = None) -> None:
    """Insert one searchable case with a semantic embedding vector."""
    with SessionLocal() as db:
        db.add(
            Case(
                case_id=case_id,
                source_type="crawler",
                source_url=f"https://example.com/{case_id}",
                title=text[:40],
                body=text,
                label="fraud" if risk_level == "high" else "unlabeled",
                risk_level=risk_level,
                risk_score=0.91 if risk_level == "high" else 0.12,
                risk_flags_json=["safe_payment_evasion"] if risk_level == "high" else [],
                summary=f"{risk_level} case: {text[:48]}",
                platform_hint="joonggonara",
                chunks=[
                    CaseChunk(
                        chunk_text=text,
                        chunk_order=0,
                        embedding=embedding or [1.0, 0.0, 0.0],
                    )
                ],
            )
        )
        db.commit()


def build_payload() -> ScanCreateRequest:
    """Return a scan payload with a KakaoBank savings-account pattern."""
    return ScanCreateRequest(
        platform="joonggonara",
        page_url="https://web.joongna.com/product/1",
        page_title="콘서트 티켓 양도",
        price=163000,
        seller={"seller_id": "seller-1", "nickname": "낭닥SJ"},
        content_blocks=[
            ContentBlock(
                block_id="body-1",
                text="입금 은행 : 카카오뱅크\n계좌 번호 : 3355-28-8620726\n안전결제 없이 계좌이체만 가능해요.",
            )
        ],
        marketplace_signals=[],
        user_context=UserRiskContext(age_group="60_plus", trade_experience="low"),
    )


def test_build_rag_context_retrieves_top_three_embedding_cases_and_savings_signal(monkeypatch) -> None:
    """RAG context should expose top-3 cosine matches plus account-rule signals."""
    reset_database()
    seed_case("case_fraud_1", "콘서트 티켓 안전결제 없이 계좌이체 선입금 요구", embedding=[1.0, 0.0, 0.0])
    seed_case("case_fraud_2", "티켓 양도 카카오뱅크 계좌 입금 후 모바일티켓 전달", embedding=[0.9, 0.1, 0.0])
    seed_case("case_fraud_3", "오픈채팅으로 이동 후 선입금 요청하는 콘서트 티켓 판매", embedding=[0.8, 0.2, 0.0])
    seed_case("case_safe_1", "직거래 가능하고 안전결제 가능한 일반 거래", risk_level="low", embedding=[0.0, 1.0, 0.0])
    monkeypatch.setattr(
        retrieval_module,
        "embed_query_text",
        lambda _text, *, output_dimensionality: [1.0, 0.0, 0.0],
    )

    context = build_rag_context(
        scan_payload=build_payload(),
        external_lookup_results=[],
        user_context=UserRiskContext(age_group="60_plus", trade_experience="low"),
    )

    assert len(context.similar_cases_top3) == 3
    assert context.similarity_summary.max_score > 0
    assert context.savings_account_signals
    assert any(signal.matched_text == "3355-28-8620726" for signal in context.savings_account_signals)
    assert context.scoring_signals["has_savings_account_pattern"] is True


def test_retrieve_similar_cases_uses_stored_embedding_dimension(monkeypatch) -> None:
    """Query embeddings must be generated in the same dimension as DB case vectors."""
    reset_database()

    with SessionLocal() as db:
        db.add_all(
            [
                Case(
                    case_id="case_dim_match",
                    source_type="crawler",
                    source_url="https://example.com/match",
                    title="match",
                    body="match",
                    label="fraud",
                    risk_level="high",
                    summary="matched dimensional case",
                    chunks=[CaseChunk(chunk_text="matched chunk", chunk_order=0, embedding=[1.0, 0.0, 0.0])],
                ),
                Case(
                    case_id="case_dim_other",
                    source_type="crawler",
                    source_url="https://example.com/other",
                    title="other",
                    body="other",
                    label="normal",
                    risk_level="low",
                    summary="other dimensional case",
                    chunks=[CaseChunk(chunk_text="other chunk", chunk_order=0, embedding=[0.0, 1.0, 0.0])],
                ),
            ]
        )
        db.commit()

    def fake_embed_query_text(query_text: str, *, output_dimensionality: int) -> list[float]:
        assert query_text == "query text"
        assert output_dimensionality == 3
        return [1.0, 0.0, 0.0]

    monkeypatch.setattr(retrieval_module, "embed_query_text", fake_embed_query_text)

    results = retrieve_similar_cases("query text", top_k=1)

    assert [result.case_id for result in results] == ["case_dim_match"]
    assert results[0].score == 1.0


def test_score_rag_context_forces_high_risk_when_external_lookup_is_positive() -> None:
    """A positive external lookup should override all other scoring inputs."""
    reset_database()
    context = build_rag_context(
        scan_payload=build_payload(),
        external_lookup_results=[
            ExternalLookupResponse(
                provider="police",
                kind="account",
                keyword="3355288620726",
                status="completed",
                message="3건 이상 신고",
                source_url="https://www.police.go.kr",
                report_count=3,
                risk_found=True,
            )
        ],
        user_context=UserRiskContext(age_group="under_30", trade_experience="high"),
    )

    score = score_rag_context(context)

    assert score.risk_points == 200
    assert score.risk_score == 1.0
    assert score.risk_level == "high"
    assert score.breakdown[0].component == "external_lookup_positive"


def test_score_rag_context_applies_user_profile_multiplier_without_external_positive(monkeypatch) -> None:
    """User age and trade experience should scale the deterministic score."""
    reset_database()
    seed_case("case_fraud_1", "콘서트 티켓 안전결제 없이 계좌이체 선입금 요구")
    monkeypatch.setattr(
        retrieval_module,
        "embed_query_text",
        lambda _text, *, output_dimensionality: [1.0, 0.0, 0.0],
    )
    payload = build_payload()
    payload.content_blocks = [
        ContentBlock(block_id="body-1", text="안전결제 가능한 일반 티켓 거래입니다.")
    ]
    monkeypatch.setattr(
        scoring_module,
        "score_listing_text",
        lambda _text: (
            RiskSpaceScore(
                embedding_risk_score=0.40,
                calibrated_pls_score=0.40,
                prototype_score=0.40,
                neighbor_score=0.40,
                prototype_cosines={},
                prototype_probabilities={},
                top_neighbors=[],
                confidence={},
            ),
            None,
            [],
        ),
    )

    low_context = build_rag_context(
        scan_payload=payload,
        external_lookup_results=[],
        user_context=UserRiskContext(age_group="under_30", trade_experience="high"),
    )
    cautious_context = build_rag_context(
        scan_payload=payload,
        external_lookup_results=[],
        user_context=UserRiskContext(age_group="70_plus", trade_experience="low"),
    )

    low_score = score_rag_context(low_context)
    cautious_score = score_rag_context(cautious_context)

    assert low_score.risk_score == 0.38
    assert cautious_score.risk_score == 0.483
    assert any(item.component == "user_profile_multiplier" for item in cautious_score.breakdown)


def test_score_rag_context_adjusts_review_history_as_trust_signal(monkeypatch) -> None:
    """Seller review counts should add small caution or trust adjustments."""
    reset_database()
    seed_case("case_fraud_1", "콘서트 티켓 안전결제 없이 계좌이체 선입금 요구")
    monkeypatch.setattr(
        retrieval_module,
        "embed_query_text",
        lambda _text, *, output_dimensionality: [1.0, 0.0, 0.0],
    )
    monkeypatch.setattr(
        scoring_module,
        "score_listing_text",
        lambda _text: (
            RiskSpaceScore(
                embedding_risk_score=0.40,
                calibrated_pls_score=0.40,
                prototype_score=0.40,
                neighbor_score=0.40,
                prototype_cosines={},
                prototype_probabilities={},
                top_neighbors=[],
                confidence={},
            ),
            None,
            [],
        ),
    )
    low_review_payload = build_payload()
    low_review_payload.content_blocks = [
        ContentBlock(block_id="body-1", text="안전결제 가능한 일반 티켓 거래입니다.")
    ]
    low_review_payload.marketplace_signals = [
        MarketplaceSignal(key="review_count", label="거래후기", value="0"),
    ]
    trusted_review_payload = build_payload()
    trusted_review_payload.content_blocks = [
        ContentBlock(block_id="body-1", text="안전결제 가능한 일반 티켓 거래입니다.")
    ]
    trusted_review_payload.marketplace_signals = [
        MarketplaceSignal(key="review_count", label="거래후기", value="31"),
    ]

    low_review_score = score_rag_context(
        build_rag_context(
            scan_payload=low_review_payload,
            external_lookup_results=[],
            user_context=UserRiskContext(age_group="under_30", trade_experience="medium"),
        )
    )
    trusted_review_score = score_rag_context(
        build_rag_context(
            scan_payload=trusted_review_payload,
            external_lookup_results=[],
            user_context=UserRiskContext(age_group="under_30", trade_experience="medium"),
        )
    )

    assert low_review_score.risk_score == 0.45
    assert trusted_review_score.risk_score == 0.30
    assert low_review_score.risk_points > trusted_review_score.risk_points
    assert any(item.component == "seller_review_history" for item in low_review_score.breakdown)
    assert any(item.component == "seller_review_history" for item in trusted_review_score.breakdown)
