"""Deterministic scan risk scoring using RAG context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.schemas.scan import RiskScoreComponent
from app.services.rag.context import RAGContext
from app.services.risk_space.service import (
    build_embedding_breakdown,
    risk_level_from_score,
    score_listing_text,
)


@dataclass(frozen=True)
class RAGScore:
    """Final deterministic score and its public API breakdown."""

    risk_points: int
    risk_score: float
    risk_level: Literal["low", "medium", "high"]
    breakdown: list[RiskScoreComponent]
    embedding_risk_score: float | None = None
    risk_space_model_version: str | None = None


def score_rag_context(context: RAGContext) -> RAGScore:
    """Score a scan without asking the LLM to make numeric decisions."""
    if bool(context.scoring_signals.get("external_lookup_positive")):
        return RAGScore(
            risk_points=200,
            risk_score=1.0,
            risk_level="high",
            breakdown=[
                RiskScoreComponent(
                    component="external_lookup_positive",
                    points=200,
                    reason="외부 신고 이력이 확인되어 즉시 중단 신호로 처리했습니다.",
                    value=1.0,
                    metadata={"external_override": True},
                )
            ],
        )

    embedding_score, artifact, risk_space_warnings = score_listing_text(context.listing_text)
    breakdown: list[RiskScoreComponent] = build_embedding_breakdown(
        score=embedding_score,
        artifact=artifact,
        warnings=risk_space_warnings,
    )
    base_score = embedding_score.embedding_risk_score if embedding_score is not None else 0.0
    rule_floor = 0.0
    rule_adjustment = 0.0

    if bool(context.scoring_signals.get("has_savings_account_pattern")):
        rule_adjustment += 0.50
        breakdown.append(
            RiskScoreComponent(
                component="savings_account_pattern",
                points=50,
                reason="은행별 적금계좌 의심 패턴이 감지되어 가산했습니다.",
                value=0.50,
                metadata={"rule_adjustment": 0.50},
            )
        )

    user_points = _user_vulnerability_points(context)
    if user_points:
        user_adjustment = user_points / 100
        rule_adjustment += user_adjustment
        breakdown.append(
            RiskScoreComponent(
                component="user_vulnerability",
                points=user_points,
                reason="사용자 연령대와 중고거래 경험을 반영해 더 보수적으로 조정했습니다.",
                value=user_adjustment,
                metadata={
                    "age_group": context.user_context.age_group,
                    "trade_experience": context.user_context.trade_experience,
                },
            )
        )

    final_score = max(rule_floor, min(base_score + rule_adjustment, 1.0))
    risk_points = round(final_score * 100)
    risk_score = round(final_score, 4)
    breakdown.append(
        RiskScoreComponent(
            component="final_score",
            points=risk_points,
            reason="embedding risk score에 rule/user adjustment를 최종 단계에서만 반영했습니다.",
            value=risk_score,
            metadata={
                "embedding_risk_score": round(base_score, 6),
                "rule_floor": rule_floor,
                "rule_adjustment": round(rule_adjustment, 6),
                "external_override": False,
                "projection_type": "embedding_pls1_primary_pls7_cosine_v1",
                "model_version": artifact.model_version if artifact else None,
            },
        )
    )
    return RAGScore(
        risk_points=risk_points,
        risk_score=risk_score,
        risk_level=risk_level_from_score(risk_score),
        breakdown=breakdown,
        embedding_risk_score=round(base_score, 6) if embedding_score is not None else None,
        risk_space_model_version=artifact.model_version if artifact else None,
    )


def _user_vulnerability_points(context: RAGContext) -> int:
    points = 0
    if context.user_context.age_group == "60_plus":
        points += 15
    if context.user_context.trade_experience == "low":
        points += 15
    elif context.user_context.trade_experience == "medium":
        points += 7
    return points
