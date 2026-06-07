"""Contract tests for the pipeline FastAPI service."""

from fastapi.testclient import TestClient
import pytest

import main
from main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def disable_gemini_analysis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep contract tests offline unless a test explicitly mocks Gemini output."""
    monkeypatch.setattr(main, "analyze_listing_with_gemini", lambda *_args, **_kwargs: None)


def build_analyze_payload() -> dict:
    """Return the exact request shape sent by the backend PipelineClient."""
    return {
        "scan_id": "scan_contract",
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
                "text": "Please use bank transfer and message me on Kakao for the concert ticket.",
            }
        ],
    }


def test_health_endpoint() -> None:
    """Ensure the backend health check can reach the pipeline."""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_analyze_response_matches_backend_contract() -> None:
    """Ensure analyze returns every field required by backend PipelineInboundPayload."""
    response = client.post("/api/v1/analyze", json=build_analyze_payload())

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {
        "risk_level",
        "risk_score",
        "summary",
        "risk_tags",
        "evidence_items",
        "highlight_targets",
        "similar_cases",
        "recommended_actions",
        "degraded",
    }
    assert body["risk_level"] in {"low", "medium", "high"}
    assert body["risk_score"] > 0
    assert "avoid_safe_payment" in body["risk_tags"]
    assert body["evidence_items"] == body["highlight_targets"]


def test_analyze_uses_rag_similar_case_search(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure similar_cases can come from the fraud-memory retrieval layer."""

    monkeypatch.setattr(main, "get_engine", lambda: object())
    monkeypatch.setattr(main, "init_db", lambda _engine: None)
    monkeypatch.setattr(
        main,
        "search_similar_cases",
        lambda *_args, **_kwargs: [
            {
                "case_id": "case_rag_001",
                "score": 0.91,
                "summary": "Retrieved similar fraud case.",
            }
        ],
    )

    response = client.post("/api/v1/analyze", json=build_analyze_payload())

    assert response.status_code == 200
    assert response.json()["similar_cases"] == [
        {
            "case_id": "case_rag_001",
            "score": 0.91,
            "summary": "Retrieved similar fraud case.",
        }
    ]


def test_analyze_can_use_gemini_structured_result(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure Gemini analysis can replace the rule-based summary while preserving the contract."""
    monkeypatch.setattr(
        main,
        "analyze_listing_with_gemini",
        lambda *_args, **_kwargs: {
            "risk_level": "high",
            "risk_score": 0.95,
            "summary": "Gemini detected strong fraud risk.",
            "risk_tags": ["gemini_detected_payment_risk"],
            "recommended_actions": [
                {
                    "action": "avoid_transaction",
                    "description": "Do not send money until the seller is verified.",
                }
            ],
        },
    )

    response = client.post("/api/v1/analyze", json=build_analyze_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["risk_score"] == 0.95
    assert body["summary"] == "Gemini detected strong fraud risk."
    assert body["risk_tags"] == ["gemini_detected_payment_risk"]
    assert body["recommended_actions"][0]["action"] == "avoid_transaction"
