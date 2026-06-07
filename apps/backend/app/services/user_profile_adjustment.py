"""Personalize scan risk for user age and second-hand trading experience."""

from __future__ import annotations

from app.schemas.scan import RecommendedAction, ScanResultResponse, UserProfile


MAX_RISK_SCORE = 1.0
MAX_PROFILE_DELTA = 0.20
PROFILE_RISK_TAG = "user_profile_caution_adjustment"


def apply_user_profile_adjustment(
    scan: ScanResultResponse,
    user_profile: UserProfile | None,
) -> ScanResultResponse:
    """Increase caution for vulnerable users without exceeding the max score."""
    if user_profile is None or scan.risk_score is None:
        return scan

    delta, reasons = calculate_profile_delta(user_profile)
    if delta <= 0:
        return scan

    adjusted_scan = scan.model_copy(deep=True)
    original_score = scan.risk_score
    adjusted_score = min(MAX_RISK_SCORE, round(original_score + delta, 4))

    adjusted_scan.risk_score = adjusted_score
    adjusted_scan.risk_level = risk_level_from_score(adjusted_score)
    adjusted_scan.summary = append_profile_context(scan.summary, reasons)
    adjusted_scan.risk_tags = append_unique(scan.risk_tags, PROFILE_RISK_TAG)
    adjusted_scan.recommended_actions = append_profile_actions(
        actions=scan.recommended_actions,
        user_profile=user_profile,
        reasons=reasons,
    )
    return adjusted_scan


def calculate_profile_delta(user_profile: UserProfile) -> tuple[float, list[str]]:
    """Return the score increase and explanation codes for the profile."""
    delta = 0.0
    reasons: list[str] = []

    if user_profile.age is not None:
        if user_profile.age >= 65:
            delta += 0.10
            reasons.append("older_user")
        elif user_profile.age >= 50:
            delta += 0.06
            reasons.append("middle_aged_or_older_user")

    if user_profile.trade_experience_level == "beginner":
        delta += 0.10
        reasons.append("beginner_trader")
    elif user_profile.trade_experience_level == "intermediate":
        delta += 0.05
        reasons.append("intermediate_trader")

    return min(delta, MAX_PROFILE_DELTA), reasons


def risk_level_from_score(score: float) -> str:
    """Use the same risk buckets as the pipeline."""
    if score >= 0.60:
        return "high"
    if score >= 0.25:
        return "medium"
    return "low"


def append_profile_context(summary: str | None, reasons: list[str]) -> str:
    """Add a report sentence explaining that user profile caution was applied."""
    base_summary = summary or "Scan completed."
    readable_reasons = profile_reason_text(reasons)
    return (
        f"{base_summary} The final caution level also considers the user's profile"
        f" ({readable_reasons}), so the report recommends a more conservative decision."
    )


def profile_reason_text(reasons: list[str]) -> str:
    """Convert internal reason codes into compact report text."""
    labels = {
        "older_user": "older user",
        "middle_aged_or_older_user": "older transaction risk group",
        "beginner_trader": "beginner second-hand trader",
        "intermediate_trader": "intermediate second-hand trader",
    }
    return ", ".join(labels.get(reason, reason) for reason in reasons) or "profile caution"


def append_profile_actions(
    *,
    actions: list[RecommendedAction],
    user_profile: UserProfile,
    reasons: list[str],
) -> list[RecommendedAction]:
    """Add practical caution steps for less experienced or older users."""
    updated = list(actions)
    action_names = {action.action for action in updated}

    if reasons and "double_check_before_payment" not in action_names:
        updated.append(
            RecommendedAction(
                action="double_check_before_payment",
                description=(
                    "Because the user profile calls for extra caution, review the evidence with "
                    "someone experienced before sending money."
                ),
            )
        )

    if (
        user_profile.trade_experience_level in {"beginner", "intermediate"}
        and "avoid_direct_transfer_for_profile" not in action_names
    ):
        updated.append(
            RecommendedAction(
                action="avoid_direct_transfer_for_profile",
                description=(
                    "Use protected in-platform payment or in-person verification instead of direct transfer."
                ),
            )
        )

    return updated


def append_unique(values: list[str], value: str) -> list[str]:
    """Append a tag only when it is not already present."""
    if value in values:
        return list(values)
    return [*values, value]
