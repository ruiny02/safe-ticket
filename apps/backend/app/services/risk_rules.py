"""Rule-based ticket fraud risk scoring for imported marketplace posts."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class RiskRule:
    code: str
    weight: float
    phrases: tuple[str, ...]
    description: str


@dataclass(frozen=True)
class RiskAssessment:
    risk_score: float
    risk_level: str
    risk_flags: list[str]
    matched_phrases: list[str]


HIGH_SIGNAL_RULES = (
    RiskRule(
        code="payment_flow_high_risk",
        weight=0.32,
        phrases=("선입금", "입금 먼저", "먼저 입금", "계좌이체만", "입금 확인 후", "계좌 먼저"),
        description="Protected payment is bypassed or money is requested first.",
    ),
    RiskRule(
        code="safe_payment_evasion",
        weight=0.28,
        phrases=(
            "안전결제 안함",
            "안전결제 안 해요",
            "안전결제 불가",
            "안전결제 x",
            "안전거래 불가",
            "안전거래 안함",
            "번개페이 안함",
            "번개페이 불가",
        ),
        description="The seller refuses marketplace protected payment.",
    ),
    RiskRule(
        code="off_platform_contact",
        weight=0.22,
        phrases=("카톡", "카카오톡", "오픈채팅", "오픈카톡", "텔레그램", "telegram", "문자 주세요"),
        description="The listing moves communication outside the platform.",
    ),
)

MEDIUM_SIGNAL_RULES = (
    RiskRule(
        code="ticket_delivery_risk",
        weight=0.18,
        phrases=(
            "배송지 변경",
            "배송지변경",
            "명의 변경",
            "명의변경",
            "예매번호 전달",
            "예매번호만 전달",
            "모바일티켓 전달",
            "모바일 티켓 전달",
            "qr 전달",
            "qr코드 전달",
            "바코드 전달",
            "아옮",
            "아이디 옮기기",
            "현장도움",
            "대리수령",
            "현장수령",
        ),
        description="Ticket transfer depends on fragile delivery or identity-transfer flows.",
    ),
    RiskRule(
        code="refund_denial",
        weight=0.14,
        phrases=("환불 불가", "환불 안됨", "취소 불가", "단순변심으로 취소", "거래 후 환불 불가"),
        description="The seller denies refunds after transfer.",
    ),
    RiskRule(
        code="platform_purchase_avoidance",
        weight=0.14,
        phrases=("바로 구매 x", "바로구매x", "바로구매 x", "바로 구매하시지 마시고", "개인결제창", "개인 결제창"),
        description="The listing discourages normal in-platform purchase flow.",
    ),
    RiskRule(
        code="broker_like_inventory",
        weight=0.13,
        phrases=("전지역", "전체지역", "전체일정", "전일정", "회차별 좌석", "다수 보유", "원하시는 날짜", "원하시는 지역"),
        description="The seller appears to hold broad ticket inventory like a broker.",
    ),
)

LOW_SIGNAL_RULES = (
    RiskRule(
        code="verification_only_claim",
        weight=0.08,
        phrases=("인증 가능", "인증해드", "예매내역 인증", "예매 내역 인증", "구매내역 인증", "캡처 인증", "캡쳐 인증"),
        description="The listing relies on verification claims, which are weak proof by themselves.",
    ),
    RiskRule(
        code="urgency_or_low_price",
        weight=0.08,
        phrases=("급처", "오늘만", "급하게", "원가 이하", "정가 이하", "반값", "싸게 넘", "싸게 양도"),
        description="Urgency or unusually cheap pricing can pressure buyers.",
    ),
)

MITIGATING_PHRASES = (
    "번개페이만",
    "안전결제 가능합니다",
    "안전결제 가능",
    "안심결제 해주세요",
    "직거래 가능",
    "거래내역 다수",
    "후기",
    "100% 만족후기",
    "100프로 환불",
)

BOILERPLATE_PATTERNS = (
    re.compile(r"앱을 다운로드하고 더 편리한 번개장터를 만나보세요!.*?신고하기"),
    re.compile(r"상점정보/후기.*", re.S),
    re.compile(r"이 상품과 비슷해요.*", re.S),
)


def assess_ticket_fraud_risk(title: str | None, content: str | None, rendered_text: str | None = None) -> RiskAssessment:
    """Score one marketplace listing with deterministic fraud-risk rules."""
    text = normalize_detection_text(title=title, content=content, rendered_text=rendered_text)
    risk_flags: list[str] = []
    matched_phrases: list[str] = []
    score = 0.0

    for rule in (*HIGH_SIGNAL_RULES, *MEDIUM_SIGNAL_RULES, *LOW_SIGNAL_RULES):
        matches = [phrase for phrase in rule.phrases if phrase.lower() in text]
        if not matches:
            continue
        risk_flags.append(rule.code)
        matched_phrases.extend(matches[:3])
        score += rule.weight

    if {"payment_flow_high_risk", "safe_payment_evasion"}.issubset(risk_flags):
        risk_flags.append("payment_evasion_combo")
        score += 0.12

    if {"off_platform_contact", "platform_purchase_avoidance"}.issubset(risk_flags):
        risk_flags.append("off_platform_purchase_combo")
        score += 0.10

    mitigation_count = sum(1 for phrase in MITIGATING_PHRASES if phrase.lower() in text)
    if mitigation_count:
        score -= min(0.12, mitigation_count * 0.04)

    score = round(max(0.0, min(score, 1.0)), 4)
    return RiskAssessment(
        risk_score=score,
        risk_level=risk_level_from_score(score),
        risk_flags=risk_flags,
        matched_phrases=matched_phrases,
    )


def normalize_detection_text(title: str | None, content: str | None, rendered_text: str | None = None) -> str:
    """Build a focused text span and remove common marketplace boilerplate."""
    parts = [title or "", content or ""]
    if not any(part.strip() for part in parts):
        parts.append(rendered_text or "")

    text = "\n".join(parts)
    for pattern in BOILERPLATE_PATTERNS:
        text = pattern.sub(" ", text)
    return " ".join(text.lower().split())


def risk_level_from_score(score: float) -> str:
    if score >= 0.32:
        return "high"
    if score >= 0.15:
        return "medium"
    return "low"
