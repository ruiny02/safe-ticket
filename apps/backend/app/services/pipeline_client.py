"""Dummy AI pipeline client used to simulate request and response flow."""

from app.schemas.scan import (
    EvidenceItem,
    PipelineInboundPayload,
    PipelineOutboundPayload,
    RecommendedAction,
    ScanCreateRequest,
    SimilarCase,
)


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
        first_block = outbound_payload.content_blocks[0]

        # The response mirrors the fields described in the backend docs.
        return PipelineInboundPayload(
            risk_level="high",
            risk_score=0.87,
            summary=(
                "Dummy pipeline response: the listing includes phrases that look risky, "
                "so the backend received a completed analysis payload."
            ),
            risk_tags=["avoid_safe_payment", "off_platform_contact"],
            evidence_items=[
                EvidenceItem(
                    block_id=first_block.block_id,
                    start=0,
                    end=min(len(first_block.text), 18),
                    matched_text=first_block.text[:18],
                    reason_code="avoid_safe_payment",
                    reason="Dummy evidence showing how the pipeline can highlight risky wording.",
                )
            ],
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


# A single shared client keeps the scaffold simple and easy to test.
dummy_pipeline_client = DummyPipelineClient()
