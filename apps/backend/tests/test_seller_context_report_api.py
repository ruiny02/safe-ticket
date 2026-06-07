"""Tests for seller profile context reports."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.db.base import Base
from app.db.session import engine
from app.main import app
from app.schemas.scan import EvidenceItem, PipelineInboundPayload, RecommendedAction, SimilarCase
from app.schemas.seller import SellerContextReportResponse, SellerProfileSnapshot
from app.services import pipeline_client as pipeline_client_module
from app.services import seller_context_report as seller_context_report_module
from app.services import seller_profile_fetcher as seller_profile_fetcher_module


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_database() -> None:
    """Rebuild test tables so each seller report test starts clean."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def build_scan_payload() -> dict:
    """Return a listing that differs from the seller's usual game-code profile."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/123",
        "page_title": "Concert ticket transfer",
        "price": 120000,
        "seller": {
            "seller_id": "seller123",
            "nickname": "code-shop",
        },
        "content_blocks": [
            {
                "block_id": "body-1",
                "text": "Please use bank transfer first and message me on Kakao for the concert ticket.",
            }
        ],
        "marketplace_signals": [],
    }


def build_pipeline_result() -> PipelineInboundPayload:
    """Return a high-risk scan result used as seller report grounding."""
    evidence = [
        EvidenceItem(
            block_id="body-1",
            start=11,
            end=24,
            matched_text="bank transfer",
            reason_code="avoid_safe_payment",
            reason="Direct bank transfer before delivery is risky.",
        )
    ]
    return PipelineInboundPayload(
        risk_level="high",
        risk_score=0.84,
        summary="High risk due to direct transfer and off-platform contact.",
        risk_tags=["avoid_safe_payment", "off_platform_contact"],
        evidence_items=evidence,
        highlight_targets=evidence,
        similar_cases=[SimilarCase(case_id="case_1", score=0.8, summary="Ticket transfer scam pattern.")],
        recommended_actions=[
            RecommendedAction(action="use_safe_payment", description="Use protected payment.")
        ],
        degraded=False,
    )


def build_profile_snapshot() -> SellerProfileSnapshot:
    """Return extracted seller profile facts similar to a Joonggonara profile page."""
    return SellerProfileSnapshot(
        profile_url="https://web.joongna.com/store/code-shop",
        seller_name="배그최저가코드상점",
        response_rate_percent=98,
        response_time="6시간 이내 응답",
        trust_index=394,
        safe_payment_count=0,
        review_count=0,
        follower_count=143,
        total_products=290,
        recent_product_titles=["배틀그라운드 코드", "게임 스킨", "게임 쿠폰"],
        raw_text_excerpt="배그최저가코드상점 응답률 98% 신뢰지수 394 안심결제 0 거래후기 0 단골 143 총 290개",
    )


def test_seller_context_report_uses_scan_and_profile_context(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure the endpoint sends scan evidence and profile facts into the report service."""
    observed: dict[str, object] = {}
    monkeypatch.setattr(
        pipeline_client_module.pipeline_client,
        "analyze",
        lambda *_args, **_kwargs: build_pipeline_result(),
    )
    monkeypatch.setattr(
        seller_profile_fetcher_module.seller_profile_fetcher,
        "fetch",
        lambda _url: build_profile_snapshot(),
    )

    def mock_create_report(*, scan_result, outbound_payload, profile):
        observed["risk_score"] = scan_result.risk_score
        observed["page_title"] = outbound_payload.page_title
        observed["seller_name"] = profile.seller_name
        return SellerContextReportResponse(
            scan_id=scan_result.scan_id,
            profile_url=profile.profile_url,
            seller_name=profile.seller_name,
            seller_context_level="high_risk",
            seller_context_score=0.86,
            pattern_consistency="inconsistent",
            summary="평소 게임 코드 판매 패턴과 달리 이번 글은 콘서트 티켓 거래이며 위험 근거가 강합니다.",
            positive_profile_signals=["응답률 98%", "판매상품 290개"],
            current_listing_risk_signals=["계좌이체 선입금 요구", "외부 연락 유도"],
            pattern_shift_explanation="최근 판매 상품은 게임 코드 중심이지만 현재 글은 티켓 양도입니다.",
            recommendation="안전결제 또는 직거래 외 방식은 피하세요.",
            profile_snapshot=profile,
            source="gemini",
            model="gemini-2.5-flash",
        )

    monkeypatch.setattr(
        seller_context_report_module.seller_context_report_service,
        "create_report",
        mock_create_report,
    )

    scan_response = client.post("/api/v1/scans/sync", json=build_scan_payload())
    assert scan_response.status_code == 200

    response = client.post(
        "/api/v1/sellers/context-report",
        json={
            "scan_id": scan_response.json()["scan_id"],
            "profile_url": "https://web.joongna.com/store/code-shop",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["seller_context_level"] == "high_risk"
    assert body["pattern_consistency"] == "inconsistent"
    assert body["source"] == "gemini"
    assert body["profile_snapshot"]["trust_index"] == 394
    assert observed == {
        "risk_score": 0.84,
        "page_title": "Concert ticket transfer",
        "seller_name": "배그최저가코드상점",
    }


def test_seller_context_report_falls_back_when_gemini_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure Gemini failures still return a grounded backend report."""
    monkeypatch.setattr(
        pipeline_client_module.pipeline_client,
        "analyze",
        lambda *_args, **_kwargs: build_pipeline_result(),
    )
    monkeypatch.setattr(
        seller_profile_fetcher_module.seller_profile_fetcher,
        "fetch",
        lambda _url: build_profile_snapshot(),
    )
    monkeypatch.setattr(
        seller_context_report_module.seller_context_report_service,
        "create_report",
        lambda **_kwargs: (_ for _ in ()).throw(
            seller_context_report_module.SellerContextReportError("missing key")
        ),
    )

    scan_response = client.post("/api/v1/scans/sync", json=build_scan_payload())
    response = client.post(
        "/api/v1/sellers/context-report",
        json={
            "scan_id": scan_response.json()["scan_id"],
            "profile_url": "https://web.joongna.com/store/code-shop",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "backend"
    assert body["current_listing_risk_signals"]


def test_seller_context_report_requires_completed_scan() -> None:
    """Ensure an unknown scan id does not produce a seller report."""
    response = client.post(
        "/api/v1/sellers/context-report",
        json={
            "scan_id": "scan_missing",
            "profile_url": "https://web.joongna.com/store/code-shop",
        },
    )

    assert response.status_code == 404
