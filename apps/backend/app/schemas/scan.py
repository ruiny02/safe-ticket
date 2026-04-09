"""Schemas for scan creation, results, dummy pipeline data, and feedback."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

#판매자 정보를 따로 정의: 혹시 몰라서
class SellerInfo(BaseModel):
    """Basic seller information collected from the marketplace page."""
    # Seller identifiers help match future fraud signals and similar cases.
    seller_id: str
    nickname: str

#게시글에서 추출한 텍스트 덩어리 --> AI가 위험하다고 생각한 문장을 표시하기 위해
class ContentBlock(BaseModel):
    """A single text block extracted from the scanned page."""

    # Each block keeps a stable identifier so evidence can point back to it.
    block_id: str #html tag
    text: str

#사용자가 백엔드에게 요청을 하고자 할 때 보내는 데이터
class ScanCreateRequest(BaseModel):
    """Payload accepted when the frontend asks the backend to analyze a listing."""

    # Platform identifies which marketplace the content came from.
    platform: str = Field(examples=["joonggonara"])
    page_url: HttpUrl
    page_title: str
    price: int = Field(ge=0)
    seller: SellerInfo
    content_blocks: list[ContentBlock]

#백엔드가 사용자에게 보내는 답안: 분석 요청을 id로 조회하라는 응답
class ScanCreateResponse(BaseModel):
    """Immediate response returned after a scan job is queued."""

    # The client polls this scan id until processing is complete.
    scan_id: str
    status: Literal["queued"]
    poll_after_ms: int


#AI가 위험하다고 생각해서 백엔드에 보내는 형식
class EvidenceItem(BaseModel):
    """A matched text span that explains why a risk tag was produced."""

    block_id: str
    start: int
    end: int
    matched_text: str
    reason_code: str
    reason: str
    css_class: str = "safe-ticket-highlight-danger"

#AI가 유사하다고 판단한 데이터를 백엔드에 보내는 형식
class SimilarCase(BaseModel):
    """A retrieved case that looks similar to the current scan."""

    case_id: str
    score: float
    summary: str


#AI가 사용자에게 권장하는 행동 --> 쓸 지 모르겠음...
class RecommendedAction(BaseModel):
    """A concrete action the user can take after reading the result."""

    action: str
    description: str

#백엔드에서 AI에게 보내는 정보 형식
class PipelineOutboundPayload(BaseModel):
    """The payload the backend would send to the real AI pipeline service."""

    scan_id: str
    platform: str
    page_url: HttpUrl
    page_title: str
    price: int
    seller: SellerInfo
    content_blocks: list[ContentBlock]

#AI에게 받는 정보 형식
class PipelineInboundPayload(BaseModel):
    """The dummy result returned by the placeholder AI pipeline."""

    risk_level: Literal["low", "medium", "high"]
    risk_score: float
    summary: str
    risk_tags: list[str]
    evidence_items: list[EvidenceItem]
    highlight_targets: list[EvidenceItem]
    similar_cases: list[SimilarCase]
    recommended_actions: list[RecommendedAction]
    degraded: bool = False

#디버깅용. 주고받을 수 있는지
class PipelineExchangeResponse(BaseModel):
    """Debug schema showing both directions of backend-pipeline communication."""

    scan_id: str
    outbound_payload: PipelineOutboundPayload
    inbound_payload: PipelineInboundPayload

#사용자가 받는 결과 조회 API에서 받는 최종 응답 형식
class ScanResultResponse(BaseModel):
    """Polling response for scan status and final analysis result."""

    # The first fields are always present, even before processing finishes.
    scan_id: str
    status: Literal["queued", "processing", "completed", "partial", "failed"]

    # The remaining fields appear once the dummy pipeline has produced a result.
    risk_level: Literal["low", "medium", "high"] | None = None
    risk_score: float | None = None
    summary: str | None = None
    risk_tags: list[str] = Field(default_factory=list)
    evidence_items: list[EvidenceItem] = Field(default_factory=list)
    highlight_targets: list[EvidenceItem] = Field(default_factory=list)
    similar_cases: list[SimilarCase] = Field(default_factory=list)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list)
    degraded: bool = False
    report_url: str | None = None


#FEEDBACK 형식?? 쓸 지 모르겟음
class FeedbackRequest(BaseModel):
    """User feedback that can later improve rules or model behavior."""

    feedback_type: Literal["false_positive", "false_negative", "helpful", "not_helpful"]
    comment: str | None = None
