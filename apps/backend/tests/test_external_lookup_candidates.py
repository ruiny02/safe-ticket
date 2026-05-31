"""Tests for extracting external lookup candidates from scan text blocks."""

from app.schemas.scan import ContentBlock
from app.services.rules.external_lookup_candidates import extract_external_lookup_candidates


def test_extracts_korean_phone_and_account_candidates() -> None:
    """The extractor should normalize phone and account numbers from transaction text."""
    candidates = extract_external_lookup_candidates(
        [
            ContentBlock(
                block_id="payment",
                text="입금 은행: 카카오뱅크\n계좌 번호: 3355-28-8620726\n연락처는 010-4112-0302 입니다.",
            )
        ]
    )

    assert [(candidate.kind, candidate.keyword) for candidate in candidates] == [
        ("account", "3355288620726"),
        ("phone", "01041120302"),
    ]


def test_deduplicates_candidates_and_ignores_plain_price_text() -> None:
    """Repeated numbers should be looked up once, while prices should not become account numbers."""
    candidates = extract_external_lookup_candidates(
        [
            ContentBlock(block_id="summary", text="가격은 163000원이고 연락처는 01041120302입니다."),
            ContentBlock(block_id="details", text="다시 남깁니다. 연락처 010-4112-0302, 가격 163000원"),
        ]
    )

    assert [(candidate.kind, candidate.keyword) for candidate in candidates] == [("phone", "01041120302")]
