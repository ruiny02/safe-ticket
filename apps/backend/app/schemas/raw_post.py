"""Schemas for raw marketplace post ingestion and import."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class RawPostCreateRequest(BaseModel):
    """Raw crawler output accepted before backend LLM or embedding work."""

    platform: str = Field(min_length=1, examples=["bungaejangter", "joonggonara"])
    source_url: str = Field(min_length=1, examples=["https://m.bunjang.co.kr/products/412388462"])
    title: str | None = None
    content: str | None = None
    price: str | None = None
    seller_id: str | None = None
    raw_html: str | None = None
    rendered_text: str | None = None
    crawled_at: datetime | None = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)
    ingest_source: str = Field(default="pipeline", min_length=1)
    source_file: str | None = None
    raw_post_id: str | None = None

    @field_validator("platform", "source_url", "ingest_source", mode="before")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        return str(value or "").strip()


class RawPostResponse(BaseModel):
    """Response returned after a raw post is stored or refreshed."""

    raw_post_id: str
    created: bool
    platform: str
    source_url: str
    title: str | None = None
    crawled_at: datetime | None = None


class RawPostBulkRequest(BaseModel):
    """Batch ingestion request used by the local collection pipeline."""

    items: list[RawPostCreateRequest] = Field(min_length=1, max_length=200)


class RawPostBulkResponse(BaseModel):
    """Summary for a batch raw ingest request."""

    total: int
    created: int
    updated: int
    items: list[RawPostResponse]


class RawPostImportResponse(BaseModel):
    """Summary for importing raw posts into backend RAG memory tables."""

    raw_posts_seen: int
    cases_created: int
    cases_updated: int
    chunks_created: int
    entities_created: int
    seller_observations_created: int
    risk_level_counts: dict[str, int] = Field(default_factory=dict)
