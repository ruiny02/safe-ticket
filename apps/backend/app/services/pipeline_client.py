"""Dummy AI pipeline client used to simulate request and response flow."""

from app.schemas.scan import (
    ContentBlock,
    EvidenceItem,
    PipelineInboundPayload,
    PipelineOutboundPayload,
    RecommendedAction,
    ScanCreateRequest,
    SimilarCase,
)
from app.services.rules.savings_account_rules import build_savings_account_evidence_items


"""
백엔드가 AI 파이프라인과 통신할 때 사용할 클라이언트

목적
1.백엔드 요청 데이터를 AI 파이프라인으로 보낼 형태로 바꾸기
2.실제 AI 대신 가짜 분석 결과를 만들어 주기


"""

#AI pipeline의 역할을 하는 dummy
class DummyPipelineClient:
    """Pretend to send listing data to an AI pipeline and return fake results."""

    #프론트가 보낸 요청에 scan id만 붙여서 ai용 데이터로 변환
    def build_outbound_payload(self, scan_id: str, payload: ScanCreateRequest) -> PipelineOutboundPayload:
        """Transform the API request into the pipeline-facing payload shape."""
        return PipelineOutboundPayload(
            scan_id=scan_id,
            platform=payload.platform,
            page_url=payload.page_url,
            page_title=payload.page_title,
            price=payload.price,
            seller=payload.seller,
            content_blocks=payload.content_blocks,
        )
    #분석 결과 출력
    def analyze(self, outbound_payload: PipelineOutboundPayload) -> PipelineInboundPayload:
        """Return dummy analysis data instead of calling a real AI service."""
        evidence_items = self._build_evidence_items(outbound_payload.content_blocks)
        risk_tags = ["avoid_safe_payment", "off_platform_contact"]
        if any(item.reason_code == "bank_account_pattern" for item in evidence_items):
            risk_tags.append("bank_account_pattern")

        # The response mirrors the fields described in the backend docs.
        return PipelineInboundPayload(
            risk_level="high",
            risk_score=0.87,
            summary=(
                "Dummy pipeline response: the listing includes phrases that look risky, "
                "so the backend received a completed analysis payload."
            ),
            risk_tags=risk_tags,
            evidence_items=evidence_items,
            highlight_targets=evidence_items,
            similar_cases=[
                SimilarCase(
                    case_id="case_123",
                    score=0.81,
                    summary="Dummy similar case returned from the placeholder retrieval stage.",
                )
            ],
            recommended_actions=[
                RecommendedAction(
                    action="use_safe_payment",
                    description="Use the platform's protected payment flow before transferring money.",
                ),
                RecommendedAction(
                    action="verify_identity",
                    description="Ask the seller to verify identity through the marketplace channel.",
                ),
            ],
            degraded=False,
        )

    def _build_evidence_items(self, content_blocks: list[ContentBlock]) -> list[EvidenceItem]:
        """Create deterministic evidence spans that the extension can render on the page."""
        rules = [
            {
                "block_id": "title",
                "needle": "Transfer me first",
                "reason_code": "avoid_safe_payment",
                "reason": "The listing asks for money transfer before platform-safe payment.",
            },
            {
                "block_id": "body-1",
                "needle": "messenger",
                "reason_code": "off_platform_contact",
                "reason": "The listing tries to move the conversation off-platform.",
            },
        ]
        evidence_items: list[EvidenceItem] = []

        for rule in rules:
            block = next((item for item in content_blocks if item.block_id == rule["block_id"]), None)
            if block is None:
                continue

            start = block.text.find(rule["needle"])
            if start < 0:
                continue

            evidence_items.append(
                EvidenceItem(
                    block_id=block.block_id,
                    start=start,
                    end=start + len(rule["needle"]),
                    matched_text=rule["needle"],
                    reason_code=rule["reason_code"],
                    reason=rule["reason"],
                )
            )

        evidence_items.extend(build_savings_account_evidence_items(content_blocks))

        if evidence_items:
            return self._dedupe_evidence_items(evidence_items)

        fallback_block = content_blocks[0]
        fallback_text = fallback_block.text[: min(len(fallback_block.text), 18)]
        return [
            EvidenceItem(
                block_id=fallback_block.block_id,
                start=0,
                end=len(fallback_text),
                matched_text=fallback_text,
                reason_code="generic_risk",
                reason="Dummy fallback evidence used when no known risky keywords are present.",
            )
        ]

    def _dedupe_evidence_items(self, items: list[EvidenceItem]) -> list[EvidenceItem]:
        """Keep item order stable while removing duplicates generated by overlapping rules."""
        deduped: list[EvidenceItem] = []
        seen: set[tuple[str, int, int, str]] = set()

        for item in items:
            key = (item.block_id, item.start, item.end, item.reason_code)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)

        return deduped


# A single shared client keeps the scaffold simple and easy to test.
dummy_pipeline_client = DummyPipelineClient()
