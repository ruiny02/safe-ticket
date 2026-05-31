"""Schemas for external fraud lookup services."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


ExternalLookupProvider = Literal["police", "thecheat"]
ExternalLookupKind = Literal["phone", "account"]
ExternalLookupStatus = Literal["completed", "login_required", "failed"]


class ExternalLookupRequest(BaseModel):
    """Lookup request created from frontend-parsed transaction text."""

    provider: ExternalLookupProvider
    kind: ExternalLookupKind
    keyword: str = Field(min_length=3, max_length=80)

    @field_validator("keyword")
    @classmethod
    def normalize_keyword(cls, value: str) -> str:
        """Keep digits only so all providers receive a stable lookup key."""
        normalized = "".join(char for char in value if char.isdigit())
        if len(normalized) < 3:
            raise ValueError("keyword must contain at least 3 digits")
        return normalized


class ExternalLookupResponse(BaseModel):
    """Normalized lookup result returned to the frontend."""

    provider: ExternalLookupProvider
    kind: ExternalLookupKind
    keyword: str
    status: ExternalLookupStatus
    message: str
    source_url: str
    report_count: int | None = None
    risk_found: bool | None = None
    result_text: str | None = None
