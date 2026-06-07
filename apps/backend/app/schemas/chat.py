"""Schemas for assistant chat requests and replies."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.scan import ScanCreateRequest, ScanResultResponse


class ChatMessage(BaseModel):
    """A previous frontend chat message."""

    role: Literal["assistant", "user"]
    text: str


class ChatReplyRequest(BaseModel):
    """Payload sent by the browser extension when the user asks a question."""

    prompt: str = Field(min_length=1)
    page_url: str
    scan_id: str | None = None
    listing: ScanCreateRequest | None = None
    scan_result: ScanResultResponse | None = None
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatReplyResponse(BaseModel):
    """Normalized assistant response consumed by the frontend chat panel."""

    reply: str
    source: Literal["backend", "gemini"] = "backend"
    model: str | None = None


# Backward-compatible names used by older backend tests and route code.
ChatConversationMessage = ChatMessage
ChatRequestPayload = ChatReplyRequest
