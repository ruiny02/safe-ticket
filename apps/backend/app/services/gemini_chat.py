"""Small Gemini REST client for the extension chat panel."""

from __future__ import annotations

import httpx

from app.core.config import get_settings
from app.schemas.chat import ChatReplyRequest


GEMINI_GENERATE_CONTENT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiChatError(RuntimeError):
    """Base error for Gemini chat failures."""


class GeminiChatConfigurationError(GeminiChatError):
    """Raised when Gemini chat cannot run because required settings are missing."""


class GeminiChatService:
    """Build a compact transaction-safety prompt and call Gemini."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        """Allow tests to inject settings without mutating global environment."""
        settings = get_settings()
        self.api_key = api_key if api_key is not None else settings.gemini_api_key
        self.model = model if model is not None else settings.gemini_chat_model
        self.timeout_seconds = (
            timeout_seconds if timeout_seconds is not None else settings.gemini_api_timeout_seconds
        )

    def reply(self, payload: ChatReplyRequest) -> str:
        """Return a short Gemini-generated answer for a scan-context question."""
        if not self.api_key:
            raise GeminiChatConfigurationError("GEMINI_API_KEY is not configured.")

        request_url = f"{GEMINI_GENERATE_CONTENT_BASE_URL}/{self.model}:generateContent"
        request_body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": self._build_prompt(payload)}],
                }
            ],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 1024,
                "thinkingConfig": {
                    "thinkingBudget": 0,
                },
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(request_url, headers=headers, json=request_body)
                response.raise_for_status()
                response_body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GeminiChatError(f"Gemini chat request failed: {exc}") from exc

        return self._extract_reply(response_body)

    def _build_prompt(self, payload: ChatReplyRequest) -> str:
        """Build one compact prompt without retrieval or heavy system instructions."""
        listing = payload.listing
        scan_result = payload.scan_result
        listing_lines = []
        if listing is not None:
            listing_lines = [
                f"제목: {listing.page_title}",
                f"가격: {listing.price}",
                f"판매자: {listing.seller.nickname}",
                "본문:",
                "\n".join(block.text for block in listing.content_blocks[:4]),
            ]

        scan_lines = []
        if scan_result is not None:
            scan_lines = [
                f"위험도: {scan_result.risk_level} / {scan_result.risk_score}",
                f"요약: {scan_result.summary}",
                f"태그: {', '.join(scan_result.risk_tags)}",
                "권장 행동: "
                + "; ".join(action.description for action in scan_result.recommended_actions[:3]),
            ]

        recent_messages = "\n".join(
            f"{message.role}: {message.text}" for message in payload.messages[-6:] if message.text.strip()
        )

        return "\n\n".join(
            part
            for part in [
                (
                    "너는 중고거래 사기 위험을 설명하는 보조자다. 확정적으로 단정하지 말고, "
                    "근거와 다음 행동을 한국어로 답하라. 답변 분량은 사용자의 요청을 반드시 따른다: "
                    "'짧게·한 줄·간단히'면 1~2문장으로 핵심만, '길게·자세히·구체적으로'면 "
                    "6문장 이상으로 위험 근거·맥락·단계별 대응을 풍부하게 설명하라. "
                    "분량 지정이 없으면 2~4문장으로 답하라."
                ),
                f"사용자 질문: {payload.prompt}",
                "최근 대화:\n" + recent_messages if recent_messages else "",
                "거래 정보:\n" + "\n".join(listing_lines) if listing_lines else "",
                "스캔 결과:\n" + "\n".join(scan_lines) if scan_lines else "",
            ]
            if part
        )

    def _extract_reply(self, response_body: object) -> str:
        """Extract text parts from Gemini's generateContent response."""
        if not isinstance(response_body, dict):
            raise GeminiChatError("Gemini chat returned a non-object response.")

        candidates = response_body.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise GeminiChatError("Gemini chat returned no candidates.")

        first_candidate = candidates[0]
        if not isinstance(first_candidate, dict):
            raise GeminiChatError("Gemini chat returned an invalid candidate.")

        content = first_candidate.get("content")
        if not isinstance(content, dict):
            raise GeminiChatError("Gemini chat returned a candidate without content.")

        parts = content.get("parts")
        if not isinstance(parts, list):
            raise GeminiChatError("Gemini chat returned content without parts.")

        reply = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
        if not reply:
            raise GeminiChatError("Gemini chat returned an empty reply.")

        return reply


gemini_chat_service = GeminiChatService()
