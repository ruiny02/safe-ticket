"""Unit tests for the Gemini chat client."""

from __future__ import annotations

import httpx

from app.core.config import Settings
from app.schemas.chat import ChatMessage, ChatReplyRequest
from app.services.gemini_chat import GeminiChatService


def build_chat_request() -> ChatReplyRequest:
    """Return a minimal request for Gemini service tests."""
    return ChatReplyRequest(
        prompt="왜 위험한가요?",
        page_url="https://web.joongna.com/product/227242032",
        scan_id="scan_123",
        listing=None,
        scan_result=None,
        messages=[
            ChatMessage(role="assistant", text="무엇을 도와드릴까요?"),
            ChatMessage(role="user", text="왜 위험한가요?"),
        ],
    )


def test_gemini_chat_service_calls_generate_content(monkeypatch) -> None:
    """Ensure Gemini requests use the configured model and API key header."""
    observed: dict[str, object] = {}

    def mock_post(self: httpx.Client, url: str, **kwargs) -> httpx.Response:
        observed["url"] = url
        observed["headers"] = kwargs["headers"]
        observed["json"] = kwargs["json"]
        request = httpx.Request("POST", url)
        return httpx.Response(
            200,
            request=request,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": "안전결제 없이 계좌이체를 요구하는 점이 위험합니다.",
                                }
                            ]
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    service = GeminiChatService(api_key="test-key", model="gemini-2.5-flash", timeout_seconds=3)
    reply = service.reply(build_chat_request())

    assert reply == "안전결제 없이 계좌이체를 요구하는 점이 위험합니다."
    assert observed["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    )
    assert observed["headers"] == {
        "Content-Type": "application/json",
        "x-goog-api-key": "test-key",
    }
    body = observed["json"]
    assert isinstance(body, dict)
    assert body["contents"][-1]["role"] == "user"
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}


def test_settings_reads_gemini_chat_model(monkeypatch) -> None:
    """Ensure only the corrected Gemini chat model env name is used."""
    monkeypatch.setenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")

    settings = Settings()

    assert settings.gemini_chat_model == "gemini-2.5-flash"
