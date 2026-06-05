"""API tests for Gemini-backed chat replies."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.main import app


client = TestClient(app)


def build_chat_payload() -> dict:
    """Return the chat payload shape sent by the browser extension."""
    return {
        "prompt": "왜 이 거래가 위험한가요?",
        "page_url": "https://web.joongna.com/product/227242032",
        "scan_id": "scan_123",
        "listing": {
            "platform": "joonggonara",
            "page_url": "https://web.joongna.com/product/227242032",
            "page_title": "콘서트 티켓 양도",
            "price": 163000,
            "seller": {
                "seller_id": "seller-1",
                "nickname": "낭닥SJ",
            },
            "content_blocks": [
                {
                    "block_id": "body-1",
                    "text": "카카오뱅크 3355-28-8620726 계좌로 입금 부탁드립니다.",
                }
            ],
            "marketplace_signals": [],
        },
        "scan_result": {
            "scan_id": "scan_123",
            "status": "completed",
            "risk_level": "medium",
            "risk_score": 0.45,
            "summary": "Medium risk detected based on ticket and account signals.",
            "risk_tags": ["ticket_transfer_risk", "avoid_safe_payment"],
            "evidence_items": [],
            "highlight_targets": [],
            "similar_cases": [],
            "recommended_actions": [
                {
                    "action": "use_safe_payment",
                    "description": "Use protected payment before transferring money.",
                }
            ],
            "external_lookup_results": [],
            "degraded": False,
            "report_url": "/report/scan_123",
        },
        "messages": [
            {"role": "assistant", "text": "무엇을 도와드릴까요?"},
            {"role": "user", "text": "왜 위험한가요?"},
        ],
    }


def test_chat_reply_endpoint_returns_gemini_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure the frontend chat endpoint returns a normalized assistant reply."""
    from app.api.routes import chat as chat_route

    def mock_reply(payload):
        assert payload.prompt == "왜 이 거래가 위험한가요?"
        assert payload.listing is not None
        return "계좌 입금 유도와 티켓 양도 맥락이 함께 있어 안전결제 사용 전에는 송금하지 않는 것이 좋습니다."

    monkeypatch.setattr(chat_route.gemini_chat_service, "reply", mock_reply)

    response = client.post("/api/v1/chat/reply", json=build_chat_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "gemini"
    assert "안전결제" in body["reply"]

