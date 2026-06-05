"""Schemas for the lightweight report chat endpoint used by the frontend."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

from app.schemas.scan import ScanCreateRequest, ScanResultResponse


class ChatConversationMessage(BaseModel):
    """One previous message from the frontend chat panel."""

    role: Literal["assistant", "user"]
    text: str


class ChatRequestPayload(BaseModel):
    """Payload sent by the frontend when the user asks about a scan result."""

    prompt: str = Field(min_length=1)
    page_url: HttpUrl
    scan_id: str | None = None
    listing: ScanCreateRequest | None = None
    scan_result: ScanResultResponse | None = None
    messages: list[ChatConversationMessage] = Field(default_factory=list)


class ChatReplyResponse(BaseModel):
    """Backend reply shape accepted by the frontend chat normalizer."""

    reply: str
    source: Literal["backend", "gemini"] = "backend"
