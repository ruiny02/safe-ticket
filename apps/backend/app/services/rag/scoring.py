"""Deterministic scan risk scoring using RAG context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.schemas.scan import RiskScoreComponent
from app.services.rag.context import RAGContext


@dataclass(frozen=True)
class RAGScore:
    """Final deterministic score and its public API breakdown."""

    risk_points: int
    risk_score: float
    risk_level: Literal["low", "medium", "high"]
    breakdown: list[RiskScoreComponent]


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
                )
            ],
        )

    breakdown: list[RiskScoreComponent] = []
    similarity_points = round(max(0.0, min(context.similarity_summary.max_score, 1.0)) * 70)
    if similarity_points:
        breakdown.append(
            RiskScoreComponent(
                component="similarity",
                points=similarity_points,
                reason="현재 게시글과 가까운 과거 사례의 cosine similarity를 반영했습니다.",
            )
        )

    if bool(context.scoring_signals.get("has_savings_account_pattern")):
        breakdown.append(
            RiskScoreComponent(
                component="savings_account_pattern",
                points=50,
                reason="은행별 적금계좌 의심 패턴이 감지되어 가산했습니다.",
            )
        )

    user_points = _user_vulnerability_points(context)
    if user_points:
        breakdown.append(
            RiskScoreComponent(
                component="user_vulnerability",
                points=user_points,
                reason="사용자 연령대와 중고거래 경험을 반영해 더 보수적으로 조정했습니다.",
            )
        )

    risk_points = min(100, sum(item.points for item in breakdown))
    risk_score = round(risk_points / 100, 4)
    return RAGScore(
        risk_points=risk_points,
        risk_score=risk_score,
        risk_level=_risk_level_from_points(risk_points),
        breakdown=breakdown,
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


def _risk_level_from_points(points: int) -> Literal["low", "medium", "high"]:
    if points >= 70:
        return "high"
    if points >= 30:
        return "medium"
    return "low"
