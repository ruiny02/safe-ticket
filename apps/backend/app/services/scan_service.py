"""Service layer that coordinates API requests and dummy pipeline processing."""

from __future__ import annotations

from uuid import uuid4

from app.core.config import get_settings
from app.repositories.in_memory import store
from app.schemas.scan import (
    FeedbackRequest,
    PipelineExchangeResponse,
    ScanCreateRequest,
    ScanCreateResponse,
    ScanResultResponse,
)
from app.services.pipeline_client import dummy_pipeline_client


class ScanService:
    """Encapsulate scan lifecycle logic so routes stay thin and readable."""

    def create_scan(self, payload: ScanCreateRequest) -> ScanCreateResponse:
        """Create a queued scan record that the client can start polling."""
        scan_id = f"scan_{uuid4().hex[:8]}"
        settings = get_settings()

        # The initial record contains only queue metadata because processing has not started yet.
        store.save_scan(
            ScanResultResponse(
                scan_id=scan_id,
                status="queued",
            )
        )

        return ScanCreateResponse(
            scan_id=scan_id,
            status="queued",
            poll_after_ms=settings.scan_poll_interval_ms,
        )

    def process_scan(self, scan_id: str) -> None:
        """Simulate sending the scan to the AI pipeline and storing its result."""
        existing_scan = store.get_scan(scan_id)
        if existing_scan is None:
            return

        # Move the job into processing so polling clients can observe progress.
        store.save_scan(existing_scan.model_copy(update={"status": "processing"}))

        exchange = store.get_pipeline_exchange(scan_id)
        if exchange is None:
            return

        # Reuse the stored dummy response so debug inspection matches the completed result exactly.
        inbound_payload = exchange.inbound_payload

        # Save the final completed scan in the format consumed by the frontend.
        final_scan = ScanResultResponse(
            scan_id=scan_id,
            status="completed",
            risk_level=inbound_payload.risk_level,
            risk_score=inbound_payload.risk_score,
            summary=inbound_payload.summary,
            risk_tags=inbound_payload.risk_tags,
            evidence_items=inbound_payload.evidence_items,
            similar_cases=inbound_payload.similar_cases,
            recommended_actions=inbound_payload.recommended_actions,
            degraded=inbound_payload.degraded,
            report_url=f"/report/{scan_id}",
        )
        store.save_scan(final_scan)
        store.save_pipeline_exchange(
            PipelineExchangeResponse(
                scan_id=scan_id,
                outbound_payload=exchange.outbound_payload,
                inbound_payload=inbound_payload,
            )
        )

    def get_scan(self, scan_id: str) -> ScanResultResponse | None:
        """Return the current scan state."""
        return store.get_scan(scan_id)

    def save_feedback(self, scan_id: str, payload: FeedbackRequest) -> bool:
        """Store feedback only when the scan exists."""
        scan = store.get_scan(scan_id)
        if scan is None:
            return False
        store.save_feedback(scan_id, payload)
        return True

    def get_pipeline_exchange(self, scan_id: str) -> PipelineExchangeResponse | None:
        """Return the recorded backend-to-pipeline exchange."""
        return store.get_pipeline_exchange(scan_id)

    def attach_pipeline_request(self, scan_id: str, payload: ScanCreateRequest) -> None:
        """Capture the outbound payload before the background task runs."""
        outbound_payload = dummy_pipeline_client.build_outbound_payload(scan_id=scan_id, payload=payload)
        store.save_pipeline_exchange(
            PipelineExchangeResponse(
                scan_id=scan_id,
                outbound_payload=outbound_payload,
                inbound_payload=dummy_pipeline_client.analyze(outbound_payload),
            )
        )


# A module-level service instance keeps route imports small.
scan_service = ScanService()
