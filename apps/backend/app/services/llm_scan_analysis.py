"""Gemini-backed scan report copy and highlight generation."""

from __future__ import annotations

import json
import re
import time

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import get_settings
from app.schemas.scan import ContentBlock, EvidenceItem, RecommendedAction
from app.services.gemini_chat import GEMINI_GENERATE_CONTENT_BASE_URL
from app.services.rag.context import RAGContext
from app.services.rag.prompt_builder import build_scan_analysis_prompt
from app.services.rag.scoring import RAGScore


class LLMScanAnalysisError(RuntimeError):
    """Raised when LLM scan analysis cannot produce a valid response."""


class LLMScanAnalysisResult(BaseModel):
    """Validated LLM output consumed by scan processing."""

    summary: str
    llm_reasoning: str
    highlight_targets: list[EvidenceItem] = Field(default_factory=list)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list)


class GeminiScanAnalysisService:
    """Call Gemini for report copy and context-aware highlight candidates."""

    def generate(self, context: RAGContext, score: RAGScore) -> LLMScanAnalysisResult:
        """Return LLM-generated copy/highlights for a completed deterministic score."""
        settings = get_settings()
        if not settings.gemini_scan_analysis_enabled:
            raise LLMScanAnalysisError("Gemini scan analysis is disabled.")
        if not settings.gemini_api_key:
            raise LLMScanAnalysisError("GEMINI_API_KEY is not configured.")

        model = getattr(settings, "gemini_analysis_model", "") or settings.gemini_chat_model
        request_url = f"{GEMINI_GENERATE_CONTENT_BASE_URL}/{model}:generateContent"
        request_body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": build_scan_analysis_prompt(context, score)}],
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 2048,
                "responseMimeType": "application/json",
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
        headers = {"Content-Type": "application/json", "x-goog-api-key": settings.gemini_api_key}

        response_body = self._send_with_retry(
            request_url=request_url,
            headers=headers,
            request_body=request_body,
            timeout_seconds=settings.gemini_api_timeout_seconds,
            max_retries=settings.gemini_max_retries,
        )

        return self._parse_response(response_body)

    def _send_with_retry(
        self,
        *,
        request_url: str,
        headers: dict[str, str],
        request_body: dict,
        timeout_seconds: float,
        max_retries: int,
    ) -> object:
        """Retry transient Gemini failures without hiding final errors."""
        retryable_status_codes = {429, 500, 502, 503, 504}
        attempts = max(0, max_retries) + 1

        with httpx.Client(timeout=timeout_seconds) as client:
            for attempt in range(attempts):
                try:
                    response = client.post(request_url, headers=headers, json=request_body)
                    response.raise_for_status()
                    return response.json()
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code not in retryable_status_codes or attempt >= attempts - 1:
                        raise LLMScanAnalysisError(f"Gemini scan analysis request failed: {exc}") from exc
                except (httpx.TimeoutException, httpx.TransportError, ValueError) as exc:
                    if attempt >= attempts - 1:
                        raise LLMScanAnalysisError(f"Gemini scan analysis request failed: {exc}") from exc

                time.sleep(0.5 * (attempt + 1))

        raise LLMScanAnalysisError("Gemini scan analysis request failed.")

    def _parse_response(self, response_body: object) -> LLMScanAnalysisResult:
        """Extract and validate the JSON object returned by Gemini."""
        text = _extract_text_response(response_body)
        try:
            payload = json.loads(_strip_json_fence(text))
            return LLMScanAnalysisResult.model_validate(payload)
        except (json.JSONDecodeError, ValidationError) as exc:
            raise LLMScanAnalysisError(f"Gemini scan analysis returned invalid JSON: {exc}") from exc


def validate_llm_highlights(highlights: list[EvidenceItem], content_blocks: list[ContentBlock]) -> list[EvidenceItem]:
    """Keep only LLM highlights that resolve to real original substrings."""
    block_by_id = {block.block_id: block.text for block in content_blocks}
    validated: list[EvidenceItem] = []

    for highlight in highlights:
        block_text = block_by_id.get(highlight.block_id)
        if block_text is None:
            continue
        if (
            0 <= highlight.start <= highlight.end <= len(block_text)
            and block_text[highlight.start:highlight.end] == highlight.matched_text
        ):
            validated.append(highlight)
            continue

        repaired = _repair_highlight_offsets(highlight, block_text)
        if repaired is not None:
            validated.append(repaired)

    return validated


def _repair_highlight_offsets(highlight: EvidenceItem, block_text: str) -> EvidenceItem | None:
    """Use matched_text as the source of truth when the LLM's offsets are wrong."""
    matched_text = highlight.matched_text.strip()
    if not matched_text:
        return None

    candidate_indexes = [match.start() for match in re.finditer(re.escape(matched_text), block_text)]
    if not candidate_indexes:
        return None

    start = min(candidate_indexes, key=lambda index: abs(index - max(0, highlight.start)))
    return highlight.model_copy(update={"start": start, "end": start + len(matched_text), "matched_text": matched_text})


def _extract_text_response(response_body: object) -> str:
    if not isinstance(response_body, dict):
        raise LLMScanAnalysisError("Gemini scan analysis returned a non-object response.")
    candidates = response_body.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise LLMScanAnalysisError("Gemini scan analysis returned no candidates.")
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    if not isinstance(content, dict):
        raise LLMScanAnalysisError("Gemini scan analysis returned a candidate without content.")
    parts = content.get("parts")
    if not isinstance(parts, list):
        raise LLMScanAnalysisError("Gemini scan analysis returned content without parts.")
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise LLMScanAnalysisError("Gemini scan analysis returned an empty response.")
    return text


def _strip_json_fence(text: str) -> str:
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)


llm_scan_analysis_service = GeminiScanAnalysisService()
