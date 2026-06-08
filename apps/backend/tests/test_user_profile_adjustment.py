"""Unit tests for the legacy user profile adjustment helper."""

from app.schemas.scan import RecommendedAction, ScanResultResponse, UserProfile
from app.services.user_profile_adjustment import apply_user_profile_adjustment


def build_scan_result(risk_score: float = 0.52) -> ScanResultResponse:
    """Return a completed scan result for direct helper testing."""
    return ScanResultResponse(
        scan_id="scan_profile_test",
        status="completed",
        risk_level="medium",
        risk_score=risk_score,
        summary="Pipeline detected payment and communication risk.",
        risk_tags=["avoid_safe_payment"],
        recommended_actions=[
            RecommendedAction(action="use_safe_payment", description="Use protected payment.")
        ],
    )


def test_user_profile_adjustment_helper_increases_score_and_context() -> None:
    """The helper remains available but is not automatically applied by scan_service."""
    adjusted = apply_user_profile_adjustment(
        build_scan_result(risk_score=0.52),
        UserProfile(age=67, trade_experience_level="beginner"),
    )

    assert adjusted.risk_score == 0.72
    assert adjusted.risk_level == "high"
    assert "user_profile_caution_adjustment" in adjusted.risk_tags
    assert "user's profile" in (adjusted.summary or "")
    assert any(
        action.action == "avoid_direct_transfer_for_profile"
        for action in adjusted.recommended_actions
    )


def test_user_profile_adjustment_helper_never_exceeds_max_score() -> None:
    """The helper clamps score to the maximum risk score."""
    adjusted = apply_user_profile_adjustment(
        build_scan_result(risk_score=0.95),
        UserProfile(age=67, trade_experience_level="beginner"),
    )

    assert adjusted.risk_score == 1.0
    assert adjusted.risk_level == "high"


def test_advanced_user_profile_does_not_change_score() -> None:
    """Experienced users do not receive extra helper weighting."""
    original = build_scan_result(risk_score=0.52)
    adjusted = apply_user_profile_adjustment(
        original,
        UserProfile(age=28, trade_experience_level="advanced"),
    )

    assert adjusted.risk_score == 0.52
    assert adjusted.risk_level == "medium"
    assert "user_profile_caution_adjustment" not in adjusted.risk_tags
