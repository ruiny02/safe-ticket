"""Schemas for scan creation, results, and real pipeline data."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

from app.schemas.external_lookup import ExternalLookupResponse


ScanStatus = Literal["queued", "processing", "completed", "partial", "failed"]


class SellerInfo(BaseModel):
    """Basic seller information collected from the marketplace page."""

    # Seller identifiers help match future fraud signals and similar cases.
    seller_id: str
    nickname: str


class ContentBlock(BaseModel):
    """A single text block extracted from the scanned page."""

    # Each block keeps a stable identifier so evidence can point back to it.
    block_id: str
    text: str


class MarketplaceSignal(BaseModel):
    """A marketplace trust or reputation signal extracted from the page."""

    key: str
    label: str
    value: str


class UserRiskContext(BaseModel):
    """Normalized user context used only for risk calibration."""

    age_group: Literal["under_30", "30_59", "60_plus", "unknown"] = "unknown"
    trade_experience: Literal["high", "medium", "low", "unknown"] = "unknown"


class ScanCreateRequest(BaseModel):
    """Payload accepted when the frontend asks the backend to analyze a listing."""

    # Platform identifies which marketplace the content came from.
    platform: str = Field(examples=["joonggonara"])
    page_url: HttpUrl
    page_title: str
    price: int = Field(ge=0)
    seller: SellerInfo
    content_blocks: list[ContentBlock]
    marketplace_signals: list[MarketplaceSignal] = Field(default_factory=list)
    user_context: UserRiskContext = Field(default_factory=UserRiskContext)


class ScanCreateResponse(BaseModel):
    """Immediate response returned after a scan job is queued."""

    # The client polls this scan id until processing is complete.
    scan_id: str
    status: Literal["queued"]
    poll_after_ms: int


class EvidenceItem(BaseModel):
    """A matched text span that explains why a risk tag was produced."""

    block_id: str
    start: int
    end: int
    matched_text: str
    reason_code: str
    reason: str
    css_class: str = "safe-ticket-highlight-danger"


class SimilarCase(BaseModel):
    """A retrieved case that looks similar to the current scan."""

    case_id: str
    score: float
    summary: str
    matched_chunk: str | None = None
    risk_level: Literal["low", "medium", "high"] | None = None
    risk_flags: list[str] = Field(default_factory=list)


class RiskScoreComponent(BaseModel):
    """One deterministic contribution to the final risk score."""

    component: str
    points: int
    reason: str


class RecommendedAction(BaseModel):
    """A concrete action the user can take after reading the result."""

    action: str
    description: str


class PipelineOutboundPayload(BaseModel):
    """The payload the backend sends to the real AI pipeline service."""

    scan_id: str
    platform: str
    page_url: HttpUrl
    page_title: str
    price: int
    seller: SellerInfo
    content_blocks: list[ContentBlock]
    marketplace_signals: list[MarketplaceSignal] = Field(default_factory=list)
    user_context: UserRiskContext = Field(default_factory=UserRiskContext)


class PipelineInboundPayload(BaseModel):
    """The validated result returned by the external pipeline service."""

    risk_level: Literal["low", "medium", "high"]
    risk_score: float
    summary: str
    risk_tags: list[str]
    evidence_items: list[EvidenceItem]
    highlight_targets: list[EvidenceItem]
    similar_cases: list[SimilarCase]
    recommended_actions: list[RecommendedAction]
    degraded: bool = False


class PipelineErrorInfo(BaseModel):
    """Backend-owned metadata describing why a pipeline call failed."""

    error_type: str
    message: str
    retryable: bool
    status_code: int | None = None


class PipelineExchangeResponse(BaseModel):
    """Debug schema showing the outbound payload plus success or failure details."""

    scan_id: str
    outbound_payload: PipelineOutboundPayload
    inbound_payload: PipelineInboundPayload | None = None
    pipeline_error: PipelineErrorInfo | None = None


class ScanListItemResponse(BaseModel):
    """Compact scan summary used by list views and quick backend inspection."""

    scan_id: str
    status: ScanStatus
    platform: str
    page_title: str
    price: int
    risk_level: Literal["low", "medium", "high"] | None = None
    risk_score: float | None = None
    summary: str | None = None


class ScanListResponse(BaseModel):
    """Paginated response containing recent scan jobs."""

    items: list[ScanListItemResponse]
    total: int
    limit: int
    offset: int


class ScanResultResponse(BaseModel):
    """Polling response for scan status and final analysis result."""

    # The first fields are always present, even before processing finishes.
    scan_id: str
    status: ScanStatus

    # The remaining fields appear once the pipeline has produced a result.
    risk_level: Literal["low", "medium", "high"] | None = None
    risk_score: float | None = None
    risk_points: int | None = None
    risk_score_breakdown: list[RiskScoreComponent] = Field(default_factory=list)
    summary: str | None = None
    llm_reasoning: str | None = None
    risk_tags: list[str] = Field(default_factory=list)
    evidence_items: list[EvidenceItem] = Field(default_factory=list)
    highlight_targets: list[EvidenceItem] = Field(default_factory=list)
    similar_cases: list[SimilarCase] = Field(default_factory=list)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list)
    external_lookup_results: list[ExternalLookupResponse] = Field(default_factory=list)
    degraded: bool = False
    report_url: str | None = None
