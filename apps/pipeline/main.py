"""FastAPI service that exposes the AI pipeline contract used by the backend."""

from __future__ import annotations

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field, HttpUrl


class HealthResponse(BaseModel):
    """Simple health-check response consumed by the backend."""

    status: Literal["ok"]


class SellerInfo(BaseModel):
    """Seller fields received from the backend scan request."""

    seller_id: str
    nickname: str


class ContentBlock(BaseModel):
    """Text block extracted from the marketplace page."""

    block_id: str
    text: str


class MarketplaceSignal(BaseModel):
    """Marketplace trust or reputation signal extracted from the page."""

    key: str
    label: str
    value: str


class UserProfile(BaseModel):
    """Optional user profile forwarded by the frontend."""

    age: int | None = Field(default=None, ge=0, le=120)
    trade_experience_level: Literal["beginner", "intermediate", "advanced"] | None = None


class PipelineOutboundPayload(BaseModel):
    """Request schema sent by the backend to the pipeline."""

    scan_id: str
    platform: str
    page_url: HttpUrl
    page_title: str
    price: int = Field(ge=0)
    seller: SellerInfo
    content_blocks: list[ContentBlock]
    marketplace_signals: list[MarketplaceSignal] = Field(default_factory=list)
    user_profile: UserProfile | None = None


class EvidenceItem(BaseModel):
    """Evidence span returned to the backend for highlighting."""

    block_id: str
    start: int
    end: int
    matched_text: str
    reason_code: str
    reason: str
    css_class: str = "safe-ticket-highlight-danger"


class SimilarCase(BaseModel):
    """Similar-case placeholder matching the backend response contract."""

    case_id: str
    score: float
    summary: str


class RecommendedAction(BaseModel):
    """Action the frontend can show to the user."""

    action: str
    description: str


class PipelineInboundPayload(BaseModel):
    """Response schema expected by backend PipelineInboundPayload validation."""

    risk_level: Literal["low", "medium", "high"]
    risk_score: float
    summary: str
    risk_tags: list[str]
    evidence_items: list[EvidenceItem]
    highlight_targets: list[EvidenceItem]
    similar_cases: list[SimilarCase]
    recommended_actions: list[RecommendedAction]
    degraded: bool = False


class RiskRule(BaseModel):
    """Rule definition used by the temporary deterministic analyzer."""

    reason_code: str
    reason: str
    keywords: list[str]
    score: float


RULES = [
    RiskRule(
        reason_code="avoid_safe_payment",
        reason="The listing appears to ask the buyer to avoid protected payment.",
        keywords=[
            "transfer me first",
            "wire first",
            "bank transfer",
            "safe payment not",
            "\uc548\uc2ec\uacb0\uc81c",
            "\ubc88\uac1c\ud398\uc774",
            "\uacc4\uc88c",
            "\uc785\uae08",
            "\uacc4\uc88c\uc774\uccb4",
            "\uce74\uce74\uc624\ubc45\ud06c",
        ],
        score=0.35,
    ),
    RiskRule(
        reason_code="off_platform_contact",
        reason="The listing appears to move communication away from the marketplace.",
        keywords=[
            "kakao",
            "telegram",
            "messenger",
            "open chat",
            "\uce74\uce74\uc624\ud1a1",
            "\uce74\ud1a1",
            "\uc624\ud508\ucc44\ud305",
            "\ud154\ub808\uadf8\ub7a8",
            "\ub77c\uc778",
        ],
        score=0.25,
    ),
    RiskRule(
        reason_code="urgency_pressure",
        reason="The listing uses urgency language that can pressure quick payment.",
        keywords=[
            "urgent",
            "today only",
            "quick sale",
            "\uc9c0\uae08",
            "\uae09\ucc98",
            "\uc624\ub298\ub9cc",
            "\ube68\ub9ac",
        ],
        score=0.15,
    ),
    RiskRule(
        reason_code="ticket_transfer_risk",
        reason="The listing discusses ticket transfer, which is a common scam context.",
        keywords=[
            "ticket",
            "concert",
            "seat",
            "\ud2f0\ucf13",
            "\ucf58\uc11c\ud2b8",
            "\uc88c\uc11d",
            "\uc591\ub3c4",
        ],
        score=0.10,
    ),
]


app = FastAPI(
    title="safe-ticket-pipeline",
    description="HTTP API used by the backend to request listing risk analysis.",
    version="0.1.0",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Return a 200 response when the pipeline service is reachable."""
    return HealthResponse(status="ok")


@app.post("/api/v1/analyze", response_model=PipelineInboundPayload)
def analyze(payload: PipelineOutboundPayload) -> PipelineInboundPayload:
    """Analyze a scan request and return the exact schema expected by the backend."""
    evidence_items: list[EvidenceItem] = []
    risk_tags: list[str] = []
    risk_score = 0.0

    for block in payload.content_blocks:
        block_text_lower = block.text.lower()
        for rule in RULES:
            matched_keyword = next(
                (keyword for keyword in rule.keywords if keyword.lower() in block_text_lower),
                None,
            )
            if matched_keyword is None:
                continue

            start = block_text_lower.find(matched_keyword.lower())
            end = start + len(matched_keyword)
            evidence_items.append(
                EvidenceItem(
                    block_id=block.block_id,
                    start=start,
                    end=end,
                    matched_text=block.text[start:end],
                    reason_code=rule.reason_code,
                    reason=rule.reason,
                )
            )
            if rule.reason_code not in risk_tags:
                risk_tags.append(rule.reason_code)
                risk_score += rule.score

    risk_score = min(round(risk_score, 2), 1.0)
    risk_level = _risk_level_from_score(risk_score)

    return PipelineInboundPayload(
        risk_level=risk_level,
        risk_score=risk_score,
        summary=_build_summary(risk_level=risk_level, risk_tags=risk_tags),
        risk_tags=risk_tags,
        evidence_items=evidence_items,
        highlight_targets=evidence_items,
        similar_cases=_build_similar_cases(risk_tags),
        recommended_actions=_build_recommended_actions(risk_tags),
        degraded=False,
    )


def _risk_level_from_score(score: float) -> Literal["low", "medium", "high"]:
    """Convert a numeric score into the backend's expected risk buckets."""
    if score >= 0.60:
        return "high"
    if score >= 0.25:
        return "medium"
    return "low"


def _build_summary(risk_level: str, risk_tags: list[str]) -> str:
    """Build a concise summary while the full AI pipeline is still being developed."""
    if not risk_tags:
        return "No major risk signals were detected by the temporary pipeline rules."

    joined_tags = ", ".join(risk_tags)
    return f"{risk_level.title()} risk detected based on these signals: {joined_tags}."


def _build_similar_cases(risk_tags: list[str]) -> list[SimilarCase]:
    """Return placeholder similar cases when risk signals are present."""
    if not risk_tags:
        return []

    return [
        SimilarCase(
            case_id="rule_based_reference_001",
            score=0.72,
            summary="Rule-based reference case generated until retrieval is connected.",
        )
    ]


def _build_recommended_actions(risk_tags: list[str]) -> list[RecommendedAction]:
    """Return user-facing actions that match the detected risk signals."""
    actions = [
        RecommendedAction(
            action="use_safe_payment",
            description="Use the marketplace's protected payment flow before transferring money.",
        )
    ]

    if "off_platform_contact" in risk_tags:
        actions.append(
            RecommendedAction(
                action="stay_on_platform",
                description="Keep conversation inside the marketplace chat when possible.",
            )
        )

    if "avoid_safe_payment" in risk_tags:
        actions.append(
            RecommendedAction(
                action="verify_seller_account",
                description="Do not send money until the seller and payment method are verified.",
            )
        )

    return actions
