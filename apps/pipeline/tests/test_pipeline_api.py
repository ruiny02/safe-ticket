"""Contract tests for the pipeline FastAPI service."""

from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


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
