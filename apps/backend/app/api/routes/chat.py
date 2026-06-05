"""Lightweight chat endpoints for frontend report testing."""

from __future__ import annotations

from fastapi import APIRouter

from app.repositories.db_store import db_store
from app.schemas.chat import ChatReplyResponse, ChatRequestPayload
from app.schemas.scan import RecommendedAction, ScanResultResponse, SimilarCase
from app.services.gemini_chat_client import generate_chat_reply


router = APIRouter()


@router.post("/reply", response_model=ChatReplyResponse)
def create_chat_reply(payload: ChatRequestPayload) -> ChatReplyResponse:
    """Return a Gemini reply when configured, otherwise use a deterministic helper reply."""
    normalized_payload = _normalize_payload(payload)
    gemini_reply = generate_chat_reply(normalized_payload)
    if gemini_reply:
        return ChatReplyResponse(reply=gemini_reply, source="gemini")
    return ChatReplyResponse(reply=_build_reply(normalized_payload))


@router.post("", response_model=ChatReplyResponse)
def create_chat_reply_alias(payload: ChatRequestPayload) -> ChatReplyResponse:
    """Support the frontend's secondary chat endpoint candidate."""
    return create_chat_reply(payload)


def _build_reply(payload: ChatRequestPayload) -> str:
    """Generate a useful non-AI answer while the real assistant pipeline is not connected."""
    scan_result = payload.scan_result
    if scan_result is None:
        return (
            "I can answer better after a scan result is available. "
            "Please run the listing scan first, then ask me about the risk summary, evidence, or next steps."
        )

    parts = [
        _risk_sentence(scan_result),
        _evidence_sentence(scan_result),
        _action_sentence(scan_result.recommended_actions),
        _similar_case_sentence(scan_result.similar_cases),
    ]
    return " ".join(part for part in parts if part)


def _normalize_payload(payload: ChatRequestPayload) -> ChatRequestPayload:
    """Prefer persisted scan data and ignore Swagger placeholder values."""
    if payload.scan_id:
        persisted_scan = db_store.get_scan(payload.scan_id)
        if persisted_scan is not None:
            return payload.model_copy(update={"scan_result": persisted_scan})

    if payload.scan_result is not None and _looks_like_placeholder_scan(payload.scan_result):
        return payload.model_copy(update={"scan_result": None})

    return payload


def _looks_like_placeholder_scan(scan_result: ScanResultResponse) -> bool:
    """Detect generated API-doc placeholder payloads such as 'string' fields."""
    placeholder_values = {"string", ""}
    text_values = [
        scan_result.summary or "",
        *(scan_result.risk_tags or []),
        *(item.matched_text for item in scan_result.evidence_items),
        *(item.reason for item in scan_result.evidence_items),
    ]
    return any(value.strip().lower() in placeholder_values for value in text_values)


def _risk_sentence(scan_result: ScanResultResponse) -> str:
    """Summarize the scan's main risk level and tags."""
    risk_level = scan_result.risk_level or "unknown"
    score = scan_result.risk_score if scan_result.risk_score is not None else 0
    if scan_result.risk_tags:
        tags = ", ".join(scan_result.risk_tags[:3])
        return f"This listing is currently marked as {risk_level} risk with score {score:.2f}; main signals are {tags}."
    return f"This listing is currently marked as {risk_level} risk with score {score:.2f}."


def _evidence_sentence(scan_result: ScanResultResponse) -> str:
    """Point the user to the strongest highlighted evidence."""
    if not scan_result.evidence_items:
        return "No highlighted evidence was returned for this scan."

    evidence = scan_result.evidence_items[0]
    return f"The strongest highlighted phrase is '{evidence.matched_text}', because {evidence.reason}"


def _action_sentence(actions: list[RecommendedAction]) -> str:
    """Suggest the first recommended action from the pipeline result."""
    if not actions:
        return ""
    action = actions[0]
    return f"Recommended next step: {action.description}"


def _similar_case_sentence(similar_cases: list[SimilarCase]) -> str:
    """Mention the top similar case when retrieval returns one."""
    if not similar_cases:
        return ""
    similar_case = similar_cases[0]
    return f"The closest similar case is {similar_case.case_id} with score {similar_case.score:.2f}."
