"""Tests for LLM scan analysis output validation."""

from __future__ import annotations

from app.schemas.scan import ContentBlock, EvidenceItem
from app.services.llm_scan_analysis import LLMScanAnalysisResult, validate_llm_highlights


def test_validate_llm_highlights_keeps_only_spans_that_match_original_text() -> None:
    """LLM highlight spans must point to real substrings before the frontend can mark DOM text."""
    blocks = [
        ContentBlock(
            block_id="body-1",
            text="안전결제 없이 카카오뱅크 3355-28-8620726 계좌로 먼저 입금해 주세요.",
        )
    ]
    valid_start = blocks[0].text.index("카카오뱅크")
    invalid_start = blocks[0].text.index("3355")

    result = LLMScanAnalysisResult(
        summary="계좌이체 유도와 적금계좌 패턴이 함께 보입니다.",
        llm_reasoning="유사 사례와 외부조회 맥락을 근거로 설명했습니다.",
        highlight_targets=[
            EvidenceItem(
                block_id="body-1",
                start=valid_start,
                end=valid_start + len("카카오뱅크"),
                matched_text="카카오뱅크",
                reason_code="llm_suspicious_bank_context",
                reason="은행명과 계좌번호가 함께 제시되어 송금 위험 맥락입니다.",
            ),
            EvidenceItem(
                block_id="body-1",
                start=invalid_start,
                end=invalid_start + len("3355-28-8620726"),
                matched_text="원문에 없는 계좌",
                reason_code="llm_invalid_span",
                reason="This should be rejected.",
            ),
        ],
        recommended_actions=[],
    )

    validated = validate_llm_highlights(result.highlight_targets, blocks)

    assert len(validated) == 1
    assert validated[0].matched_text == "카카오뱅크"
    assert validated[0].reason_code == "llm_suspicious_bank_context"


def test_validate_llm_highlights_repairs_offsets_when_matched_text_exists() -> None:
    """LLM offsets are often wrong; matched_text still must resolve to a real original substring."""
    blocks = [
        ContentBlock(
            block_id="body-1",
            text="안전결제는 어렵고 오픈채팅방으로 오세요. 티켓은 먼저 계좌이체하면 바로 보내드릴게요.",
        )
    ]

    validated = validate_llm_highlights(
        [
            EvidenceItem(
                block_id="body-1",
                start=0,
                end=99,
                matched_text="오픈채팅방으로 오세요",
                reason_code="llm_off_platform_contact",
                reason="오픈채팅방으로 이동을 유도합니다.",
            )
        ],
        blocks,
    )

    assert len(validated) == 1
    assert validated[0].start == blocks[0].text.index("오픈채팅방으로 오세요")
    assert validated[0].end == validated[0].start + len("오픈채팅방으로 오세요")
    assert blocks[0].text[validated[0].start:validated[0].end] == validated[0].matched_text
