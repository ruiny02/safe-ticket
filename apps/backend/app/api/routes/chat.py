"""Assistant chat endpoints."""

from fastapi import APIRouter, HTTPException, status

from app.schemas.chat import ChatReplyRequest, ChatReplyResponse
from app.services.gemini_chat import (
    GeminiChatConfigurationError,
    GeminiChatError,
    gemini_chat_service,
)


router = APIRouter()


def _create_chat_reply(payload: ChatReplyRequest) -> ChatReplyResponse:
    """Generate a Gemini-backed chat reply."""
    try:
        reply = gemini_chat_service.reply(payload)
    except GeminiChatConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except GeminiChatError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return ChatReplyResponse(
        reply=reply,
        model=gemini_chat_service.model,
    )


@router.post("/reply", response_model=ChatReplyResponse)
def create_chat_reply(payload: ChatReplyRequest) -> ChatReplyResponse:
    """Return a chat reply for the extension AI question panel."""
    return _create_chat_reply(payload)


@router.post("", response_model=ChatReplyResponse)
def create_chat(payload: ChatReplyRequest) -> ChatReplyResponse:
    """Compatibility endpoint for frontend chat fallback candidates."""
    return _create_chat_reply(payload)
