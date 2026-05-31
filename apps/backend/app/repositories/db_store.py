"""Database repository for persisted scan and pipeline exchange state."""

from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

from app.db.models import PipelineExchange, Scan, ScanBlock
from app.db.session import SessionLocal
from app.schemas.scan import (
    PipelineErrorInfo,
    PipelineExchangeResponse,
    PipelineInboundPayload,
    PipelineOutboundPayload,
    ScanCreateRequest,
    ScanListItemResponse,
    ScanListResponse,
    ScanResultResponse,
    ScanStatus,
)


class DatabaseStore:
    """Small persistence adapter used by the scan service."""

    def create_scan(self, scan_id: str, payload: ScanCreateRequest) -> None:
        """Persist the initial queued scan and its extracted content blocks."""
        with SessionLocal() as db:
            scan = Scan(
                scan_id=scan_id,
                platform=payload.platform,
                page_url=str(payload.page_url),
                page_title=payload.page_title,
                price=payload.price,
                status="queued",
                risk_tags=[],
                evidence_items_json=[],
                highlight_targets_json=[],
                similar_cases_json=[],
                recommended_actions_json=[],
            )
            scan.blocks = [
                ScanBlock(block_id=block.block_id, text=block.text)
                for block in payload.content_blocks
            ]
            db.add(scan)
            db.commit()

    def save_scan(self, scan: ScanResultResponse) -> None:
        """Update the persisted polling result for an existing scan."""
        with SessionLocal() as db:
            row = db.get(Scan, scan.scan_id)
            if row is None:
                return

            row.status = scan.status
            row.risk_level = scan.risk_level
            row.risk_score = scan.risk_score
            row.summary = scan.summary
            row.risk_tags = scan.risk_tags
            row.evidence_items_json = [item.model_dump(mode="json") for item in scan.evidence_items]
            row.highlight_targets_json = [item.model_dump(mode="json") for item in scan.highlight_targets]
            row.similar_cases_json = [item.model_dump(mode="json") for item in scan.similar_cases]
            row.recommended_actions_json = [item.model_dump(mode="json") for item in scan.recommended_actions]
            row.degraded = scan.degraded
            row.report_url = scan.report_url
            db.commit()

    def update_scan_status(self, scan_id: str, status: ScanStatus, summary: str | None = None) -> None:
        """Update only lifecycle fields when the scan moves between job states."""
        with SessionLocal() as db:
            row = db.get(Scan, scan_id)
            if row is None:
                return

            row.status = status
            if summary is not None:
                row.summary = summary
            db.commit()

    def get_scan(self, scan_id: str) -> ScanResultResponse | None:
        """Return a scan result if it exists."""
        with SessionLocal() as db:
            row = db.get(Scan, scan_id)
            if row is None:
                return None
            return self._scan_from_row(row)

    def list_scans(self, limit: int, offset: int) -> ScanListResponse:
        """Return recent scans with only the fields needed for list screens."""
        with SessionLocal() as db:
            query = db.query(Scan)
            total = query.count()
            rows = (
                query.order_by(Scan.created_at.desc(), Scan.scan_id.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )

            return ScanListResponse(
                items=[self._scan_list_item_from_row(row) for row in rows],
                total=total,
                limit=limit,
                offset=offset,
            )

    def save_pipeline_exchange(self, exchange: PipelineExchangeResponse) -> None:
        """Upsert the debug payload exchanged with the pipeline."""
        with SessionLocal() as db:
            row = self._get_exchange_row(db, exchange.scan_id)
            if row is None:
                row = PipelineExchange(
                    scan_id=exchange.scan_id,
                    outbound_payload=exchange.outbound_payload.model_dump(mode="json"),
                )
                db.add(row)

            row.outbound_payload = exchange.outbound_payload.model_dump(mode="json")
            row.inbound_payload = (
                exchange.inbound_payload.model_dump(mode="json")
                if exchange.inbound_payload is not None
                else None
            )
            row.pipeline_error = (
                exchange.pipeline_error.model_dump(mode="json")
                if exchange.pipeline_error is not None
                else None
            )
            db.commit()

    def get_pipeline_exchange(self, scan_id: str) -> PipelineExchangeResponse | None:
        """Return the recorded pipeline exchange for debugging."""
        with SessionLocal() as db:
            row = self._get_exchange_row(db, scan_id)
            if row is None:
                return None

            return PipelineExchangeResponse(
                scan_id=row.scan_id,
                outbound_payload=PipelineOutboundPayload.model_validate(row.outbound_payload),
                inbound_payload=(
                    PipelineInboundPayload.model_validate(row.inbound_payload)
                    if row.inbound_payload is not None
                    else None
                ),
                pipeline_error=(
                    PipelineErrorInfo.model_validate(row.pipeline_error)
                    if row.pipeline_error is not None
                    else None
                ),
            )

    def _get_exchange_row(self, db: Session, scan_id: str) -> PipelineExchange | None:
        """Fetch the single exchange row associated with a scan."""
        return (
            db.query(PipelineExchange)
            .options(selectinload(PipelineExchange.scan))
            .filter(PipelineExchange.scan_id == scan_id)
            .one_or_none()
        )

    def _scan_from_row(self, row: Scan) -> ScanResultResponse:
        """Convert the ORM row into the API polling response schema."""
        return ScanResultResponse(
            scan_id=row.scan_id,
            status=row.status,  # type: ignore[arg-type]
            risk_level=row.risk_level,  # type: ignore[arg-type]
            risk_score=row.risk_score,
            summary=row.summary,
            risk_tags=row.risk_tags or [],
            evidence_items=row.evidence_items_json or [],
            highlight_targets=row.highlight_targets_json or [],
            similar_cases=row.similar_cases_json or [],
            recommended_actions=row.recommended_actions_json or [],
            degraded=row.degraded,
            report_url=row.report_url,
        )

    def _scan_list_item_from_row(self, row: Scan) -> ScanListItemResponse:
        """Convert an ORM row into the compact list response schema."""
        return ScanListItemResponse(
            scan_id=row.scan_id,
            status=row.status,  # type: ignore[arg-type]
            platform=row.platform,
            page_title=row.page_title,
            price=row.price,
            risk_level=row.risk_level,  # type: ignore[arg-type]
            risk_score=row.risk_score,
            summary=row.summary,
        )


db_store = DatabaseStore()
