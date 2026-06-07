"""Schemas for seller profile context reports."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


SellerContextLevel = Literal["trusted", "caution", "high_risk", "unknown"]
PatternConsistency = Literal["consistent", "mixed", "inconsistent", "unknown"]


class SellerContextReportRequest(BaseModel):
    """Request to compare a seller profile with an already scanned listing."""

    scan_id: str = Field(min_length=1)
    profile_url: HttpUrl


class SellerProfileSnapshot(BaseModel):
    """Public seller-profile facts extracted before LLM analysis."""

    profile_url: str
    seller_name: str | None = None
    response_rate_percent: int | None = Field(default=None, ge=0, le=100)
    response_time: str | None = None
    trust_index: int | None = Field(default=None, ge=0)
    safe_payment_count: int | None = Field(default=None, ge=0)
    review_count: int | None = Field(default=None, ge=0)
    follower_count: int | None = Field(default=None, ge=0)
    total_products: int | None = Field(default=None, ge=0)
    recent_product_titles: list[str] = Field(default_factory=list)
    raw_text_excerpt: str


class SellerContextReportResponse(BaseModel):
    """Seller trust report grounded in profile data and current scan evidence."""

    scan_id: str
    profile_url: str
    seller_name: str | None = None
    seller_context_level: SellerContextLevel
    seller_context_score: float = Field(ge=0, le=1)
    pattern_consistency: PatternConsistency
    summary: str
    positive_profile_signals: list[str] = Field(default_factory=list)
    current_listing_risk_signals: list[str] = Field(default_factory=list)
    pattern_shift_explanation: str
    recommendation: str
    profile_snapshot: SellerProfileSnapshot
    source: Literal["gemini", "backend"] = "gemini"
    model: str | None = None
