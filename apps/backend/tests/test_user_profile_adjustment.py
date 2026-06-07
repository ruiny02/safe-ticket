"""Tests for age and trade-experience based scan personalization."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.db.base import Base
from app.db.session import engine
from app.main import app
from app.schemas.scan import EvidenceItem, PipelineInboundPayload, RecommendedAction, SimilarCase
from app.services import pipeline_client as pipeline_client_module


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_database() -> None:
    """Rebuild test tables so each profile adjustment test starts clean."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def build_scan_payload() -> dict:
    """Return a scan payload containing frontend-provided user profile data."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/123",
        "page_title": "Concert ticket sale",
        "price": 120000,
        "seller": {
            "seller_id": "seller123",
            "nickname": "ticket-seller",
        },
        "content_blocks": [
            {
                "block_id": "body-1",
                "text": "Please use bank transfer first and message me on Kakao for the concert ticket.",
            }
        ],
        "marketplace_signals": [],
        "user_profile": {
            "age": 67,
            "trade_experience_level": "beginner",
        },
    }


def build_pipeline_result(risk_score: float = 0.52) -> PipelineInboundPayload:
    """Return a pipeline response that the backend can personalize."""
    evidence = [
        EvidenceItem(
            block_id="body-1",
            start=11,
            end=24,
            matched_text="bank transfer",
            reason_code="avoid_safe_payment",
            reason="Direct transfer before delivery is risky.",
        )
    ]
    return PipelineInboundPayload(
        risk_level="medium",
        risk_score=risk_score,
        summary="Pipeline detected payment and communication risk.",
        risk_tags=["avoid_safe_payment"],
        evidence_items=evidence,
        highlight_targets=evidence,
        similar_cases=[SimilarCase(case_id="case_1", score=0.8, summary="Similar transfer scam.")],
        recommended_actions=[
            RecommendedAction(action="use_safe_payment", description="Use protected payment.")
        ],
        degraded=False,
    )


def test_user_profile_increases_score_and_report_context(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure age and beginner status increase final caution level."""
    monkeypatch.setattr(
        pipeline_client_module.pipeline_client,
        "analyze",
        lambda *_args, **_kwargs: build_pipeline_result(risk_score=0.52),
    )

    response = client.post("/api/v1/scans/sync", json=build_scan_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["risk_score"] == pytest.approx(0.72)
    assert body["risk_level"] == "high"
    assert "user_profile_caution_adjustment" in body["risk_tags"]
    assert "user's profile" in body["summary"]
    assert any(
        action["action"] == "avoid_direct_transfer_for_profile"
        for action in body["recommended_actions"]
    )


def test_user_profile_adjustment_never_exceeds_max_score(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure profile weighting clamps score to the maximum risk score."""
    monkeypatch.setattr(
        pipeline_client_module.pipeline_client,
        "analyze",
        lambda *_args, **_kwargs: build_pipeline_result(risk_score=0.95),
    )

    response = client.post("/api/v1/scans/sync", json=build_scan_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["risk_score"] == 1.0
    assert body["risk_level"] == "high"


def test_advanced_user_does_not_change_score(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure experienced users do not receive extra profile weighting."""
    monkeypatch.setattr(
        pipeline_client_module.pipeline_client,
        "analyze",
        lambda *_args, **_kwargs: build_pipeline_result(risk_score=0.52),
    )
    payload = build_scan_payload()
    payload["user_profile"] = {
        "age": 28,
        "trade_experience_level": "advanced",
    }

    response = client.post("/api/v1/scans/sync", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["risk_score"] == 0.52
    assert body["risk_level"] == "medium"
    assert "user_profile_caution_adjustment" not in body["risk_tags"]
