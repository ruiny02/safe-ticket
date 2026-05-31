"""Service layer that coordinates API requests and real pipeline processing."""

from __future__ import annotations

from uuid import uuid4

from app.core.config import get_settings
from app.repositories.db_store import db_store
from app.schemas.scan import (
    PipelineErrorInfo,
    PipelineExchangeResponse,
    ScanCreateRequest,
    ScanCreateResponse,
    ScanListResponse,
    ScanResultResponse,
)
from app.services.pipeline_client import PipelineClientError, pipeline_client


class ScanService:
    """Encapsulate scan lifecycle logic so routes stay thin and readable."""

    def create_scan(self, payload: ScanCreateRequest) -> ScanCreateResponse:
        """Create a queued scan record that the client can start polling."""
        scan_id = f"scan_{uuid4().hex[:8]}"
        settings = get_settings()

        db_store.create_scan(scan_id=scan_id, payload=payload)

        return ScanCreateResponse(
            scan_id=scan_id,
            status="queued",
            poll_after_ms=settings.scan_poll_interval_ms,
        )

    def enqueue_scan(self, payload: ScanCreateRequest) -> ScanCreateResponse:
        """Create the scan and record the outbound pipeline request in one safe step."""
        created_scan = self.create_scan(payload)
        self.attach_pipeline_request(created_scan.scan_id, payload)
        return created_scan

    def process_scan(self, scan_id: str) -> None:
        """Send the saved payload to the pipeline and translate the outcome into scan status."""
        if db_store.get_scan(scan_id) is None:
            return

        # Move the job into processing so polling clients can observe progress.
        db_store.update_scan_status(scan_id=scan_id, status="processing")

        exchange = db_store.get_pipeline_exchange(scan_id)
        if exchange is None:
            self._mark_scan_failed(
                scan_id=scan_id,
                error_info=PipelineErrorInfo(
                    error_type="pipeline_request_missing",
                    message="No outbound pipeline payload was recorded for this scan.",
                    retryable=False,
                ),
            )
            return

        try:
            inbound_payload = pipeline_client.analyze(exchange.outbound_payload)
        except PipelineClientError as exc:
            error_info = PipelineErrorInfo(
                error_type=exc.error_type,
                message=exc.message,
                retryable=exc.retryable,
                status_code=exc.status_code,
            )
            db_store.save_pipeline_exchange(
                PipelineExchangeResponse(
                    scan_id=scan_id,
                    outbound_payload=exchange.outbound_payload,
                    inbound_payload=None,
                    pipeline_error=error_info,
                )
            )
            self._mark_scan_failed(scan_id=scan_id, error_info=error_info)
            return

        # Save the final completed scan in the format consumed by the frontend.
        final_scan = ScanResultResponse(
            scan_id=scan_id,
            status="completed",
            risk_level=inbound_payload.risk_level,
            risk_score=inbound_payload.risk_score,
            summary=inbound_payload.summary,
            risk_tags=inbound_payload.risk_tags,
            evidence_items=inbound_payload.evidence_items,
            highlight_targets=inbound_payload.highlight_targets,
            similar_cases=inbound_payload.similar_cases,
            recommended_actions=inbound_payload.recommended_actions,
            degraded=inbound_payload.degraded,
            report_url=f"/report/{scan_id}",
        )
        db_store.save_scan(final_scan)
        db_store.save_pipeline_exchange(
            PipelineExchangeResponse(
                scan_id=scan_id,
                outbound_payload=exchange.outbound_payload,
                inbound_payload=inbound_payload,
                pipeline_error=None,
            )
        )

    def get_scan(self, scan_id: str) -> ScanResultResponse | None:
        """Return the current scan state."""
        return db_store.get_scan(scan_id)

    def list_scans(self, limit: int, offset: int) -> ScanListResponse:
        """Return recent scans for backend checks and future frontend list views."""
        return db_store.list_scans(limit=limit, offset=offset)

    def get_pipeline_exchange(self, scan_id: str) -> PipelineExchangeResponse | None:
        """Return the recorded backend-to-pipeline exchange."""
        return db_store.get_pipeline_exchange(scan_id)

    def attach_pipeline_request(self, scan_id: str, payload: ScanCreateRequest) -> None:
        """Capture the outbound payload before the background task runs."""
        outbound_payload = pipeline_client.build_outbound_payload(scan_id=scan_id, payload=payload)
        db_store.save_pipeline_exchange(
            PipelineExchangeResponse(
                scan_id=scan_id,
                outbound_payload=outbound_payload,
                inbound_payload=None,
                pipeline_error=None,
            )
        )

    def _mark_scan_failed(self, scan_id: str, error_info: PipelineErrorInfo) -> None:
        """Persist a stable failed scan result without leaking transport-layer details."""
        db_store.update_scan_status(scan_id=scan_id, status="failed", summary=error_info.message)


# A module-level service instance keeps route imports small.
scan_service = ScanService()
