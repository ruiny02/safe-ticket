"""Integration tests for RAG scoring and LLM analysis inside scan processing."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.db.base import Base
from app.db.models import Case, CaseChunk
from app.db.session import SessionLocal, engine
from app.main import app
from app.schemas.external_lookup import ExternalLookupResponse
from app.schemas.scan import EvidenceItem, PipelineInboundPayload
from app.services import pipeline_client as pipeline_client_module
from app.services import scan_service as scan_service_module
from app.services.llm_scan_analysis import LLMScanAnalysisResult
from app.services.rag import retrieval as retrieval_module
from app.services.rag import scoring as rag_scoring_module
from app.services.risk_space.cosine_scoring import RiskSpaceScore


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_database() -> None:
    """Rebuild test tables so each test starts from empty persisted state."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def seed_case() -> None:
    """Insert one fraud-memory case for RAG retrieval."""
    text = "콘서트 티켓 안전결제 없이 계좌이체 선입금 요구"
    with SessionLocal() as db:
        db.add(
            Case(
                case_id="case_fraud_1",
                source_type="crawler",
                source_url="https://example.com/case",
                title="콘서트 티켓 선입금 사기",
                body=text,
                label="fraud",
                risk_level="high",
                risk_score=0.9,
                risk_flags_json=["payment_flow_high_risk"],
                summary="선입금을 요구한 콘서트 티켓 사기 사례",
                platform_hint="joonggonara",
                chunks=[
                    CaseChunk(
                        chunk_text=text,
                        chunk_order=0,
                        embedding=[1.0, 0.0, 0.0],
                    )
                ],
            )
        )
        db.commit()


def build_scan_payload() -> dict:
    """Return a payload that includes public user profile data."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/product/123",
        "page_title": "콘서트 티켓 양도",
        "price": 163000,
        "seller": {"seller_id": "seller-1", "nickname": "낭닥SJ"},
        "content_blocks": [
            {
                "block_id": "body-1",
                "text": "입금 은행 : 카카오뱅크\n계좌 번호 : 3355-28-8620726\n안전결제 없이 먼저 입금해 주세요.",
            }
        ],
        "marketplace_signals": [],
        "user_profile": {
            "age": 67,
            "trade_experience_level": "beginner",
        },
    }


def build_pipeline_result() -> PipelineInboundPayload:
    """Return a low-risk pipeline result that RAG scoring should override."""
    return PipelineInboundPayload(
        risk_level="low",
        risk_score=0.1,
        summary="temporary pipeline summary",
        risk_tags=[],
        evidence_items=[],
        highlight_targets=[],
        similar_cases=[],
        recommended_actions=[],
        degraded=False,
    )


def test_scan_result_uses_rag_scoring_and_validated_llm_highlights(monkeypatch: pytest.MonkeyPatch) -> None:
    """Completed scan should expose deterministic RAG score plus LLM-generated copy/highlights."""
    seed_case()
    monkeypatch.setattr(
        retrieval_module,
        "embed_query_text",
        lambda _text, *, output_dimensionality: [1.0, 0.0, 0.0],
    )
    monkeypatch.setattr(
        rag_scoring_module,
        "score_listing_text",
        lambda _text: (
            RiskSpaceScore(
                embedding_risk_score=0.32,
                calibrated_pls_score=0.25,
                prototype_score=0.35,
                neighbor_score=0.45,
                prototype_cosines={"safe": 0.1, "fraud": 0.8},
                prototype_probabilities={"safe": 0.2, "fraud": 0.8},
                top_neighbors=[],
                confidence={"valid_neighbors": 0.0},
            ),
            None,
            [],
        ),
    )

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
        return build_pipeline_result()

    def mock_lookup(payload) -> ExternalLookupResponse:
        return ExternalLookupResponse(
            provider=payload.provider,
            kind=payload.kind,
            keyword=payload.keyword,
            status="completed",
            message="신고 이력 없음",
            source_url="https://example.com/lookup",
            report_count=0 if payload.provider == "police" else None,
            risk_found=False,
        )

    def mock_generate(rag_context, _score) -> LLMScanAnalysisResult:
        block_text = rag_context.scan_payload.content_blocks[0].text
        valid_start = block_text.index("카카오뱅크")
        invalid_start = block_text.index("3355")
        return LLMScanAnalysisResult(
            summary="계좌이체 유도와 적금계좌 패턴 때문에 추가 확인이 필요합니다.",
            llm_reasoning="RAG 유사 사례, 외부조회 결과, 사용자 취약도를 함께 반영했습니다.",
            highlight_targets=[
                EvidenceItem(
                    block_id="body-1",
                    start=valid_start,
                    end=valid_start + len("카카오뱅크"),
                    matched_text="카카오뱅크",
                    reason_code="llm_bank_context",
                    reason="은행명과 계좌번호가 함께 제시된 송금 위험 맥락입니다.",
                ),
                EvidenceItem(
                    block_id="body-1",
                    start=invalid_start,
                    end=invalid_start + len("3355-28-8620726"),
                    matched_text="원문 불일치",
                    reason_code="llm_invalid",
                    reason="This should be rejected.",
                ),
            ],
            recommended_actions=[],
        )

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)
    monkeypatch.setattr(scan_service_module.external_lookup_service, "lookup", mock_lookup)
    monkeypatch.setattr(scan_service_module.llm_scan_analysis_service, "generate", mock_generate)

    create_response = client.post("/api/v1/scans/sync", json=build_scan_payload())

    assert create_response.status_code == 200
    body = create_response.json()
    assert body["status"] == "completed"
    assert body["risk_points"] >= 70
    assert body["risk_points"] == round(body["risk_score"] * 100)
    assert body["risk_level"] == "high"
    assert body["embedding_risk_score"] == 0.32
    assert body["summary"] == "계좌이체 유도와 적금계좌 패턴 때문에 추가 확인이 필요합니다."
    assert body["llm_reasoning"] == "RAG 유사 사례, 외부조회 결과, 사용자 취약도를 함께 반영했습니다."
    assert [target["matched_text"] for target in body["highlight_targets"]] == ["카카오뱅크"]
    assert body["similar_cases"][0]["case_id"] == "case_fraud_1"
    assert body["similar_cases"][0]["matched_chunk"]
    assert {item["component"] for item in body["risk_score_breakdown"]} >= {
        "embedding_risk_score",
        "savings_account_pattern",
        "user_profile_multiplier",
        "final_score",
    }


def test_scan_result_forces_200_points_when_external_lookup_is_positive(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provider-confirmed fraud history should force a 200-point stop signal."""
    seed_case()
    monkeypatch.setattr(
        retrieval_module,
        "embed_query_text",
        lambda _text, *, output_dimensionality: [1.0, 0.0, 0.0],
    )
    monkeypatch.setattr(
        rag_scoring_module,
        "score_listing_text",
        lambda _text: (
            RiskSpaceScore(
                embedding_risk_score=0.1,
                calibrated_pls_score=0.1,
                prototype_score=0.1,
                neighbor_score=0.1,
                prototype_cosines={},
                prototype_probabilities={},
                top_neighbors=[],
                confidence={},
            ),
            None,
            [],
        ),
    )

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", lambda *_args, **_kwargs: build_pipeline_result())

    def mock_lookup(payload) -> ExternalLookupResponse:
        return ExternalLookupResponse(
            provider=payload.provider,
            kind=payload.kind,
            keyword=payload.keyword,
            status="completed",
            message="피해 신고 이력 확인",
            source_url="https://example.com/lookup",
            report_count=3,
            risk_found=payload.provider == "police",
        )

    monkeypatch.setattr(scan_service_module.external_lookup_service, "lookup", mock_lookup)
    monkeypatch.setattr(
        scan_service_module.llm_scan_analysis_service,
        "generate",
        lambda rag_context, _score: LLMScanAnalysisResult(
            summary="외부 신고 이력이 확인되어 즉시 거래를 중단해야 합니다.",
            llm_reasoning="경찰청 외부조회 positive 결과를 최우선 반영했습니다.",
            highlight_targets=[],
            recommended_actions=[],
        ),
    )

    create_response = client.post("/api/v1/scans", json=build_scan_payload())

    assert create_response.status_code == 202
    scan_id = create_response.json()["scan_id"]
    result_response = client.get(f"/api/v1/scans/{scan_id}")
    assert result_response.status_code == 200
    body = result_response.json()
    assert body["risk_points"] == 200
    assert body["risk_score"] == 1.0
    assert body["risk_level"] == "high"
    assert body["risk_score_breakdown"][0]["component"] == "external_lookup_positive"
