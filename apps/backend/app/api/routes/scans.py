"""Scan-related endpoints for AI pipeline integration."""

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status

from app.schemas.scan import (
    PipelineExchangeResponse,
    ScanCreateRequest,
    ScanCreateResponse,
    ScanListResponse,
    ScanResultResponse,
)
from app.schemas.risk_map import ScanRiskProjectionResponse
from app.services.risk_space.service import build_scan_projection_response
from app.services.scan_service import scan_service


router = APIRouter()


@router.post("", response_model=ScanCreateResponse, status_code=status.HTTP_202_ACCEPTED)
def create_scan(payload: ScanCreateRequest, background_tasks: BackgroundTasks) -> ScanCreateResponse:
    """Create a scan job and schedule pipeline processing in the background."""
    # Create the polling record and store the outbound pipeline payload together.
    created_scan = scan_service.enqueue_scan(payload)

    # The background task performs the hand-off from backend to AI pipeline.
    background_tasks.add_task(scan_service.process_scan, created_scan.scan_id)
    return created_scan


@router.post("/sync", response_model=ScanResultResponse)
def create_scan_sync(payload: ScanCreateRequest) -> ScanResultResponse:
    """Run a scan synchronously for local frontend testing flows."""
    return scan_service.run_scan_sync(payload)


@router.get("", response_model=ScanListResponse)
def list_scans(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ScanListResponse:
    """Return recent scan jobs for manual checks and future frontend history views."""
    return scan_service.list_scans(limit=limit, offset=offset)


@router.get("/{scan_id}", response_model=ScanResultResponse)
def get_scan(scan_id: str) -> ScanResultResponse:
    """Return the current status or finished result of a scan job."""
    scan = scan_service.get_scan(scan_id)
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan not found")
    return scan


@router.get("/{scan_id}/pipeline-debug", response_model=PipelineExchangeResponse)
def get_pipeline_debug(scan_id: str) -> PipelineExchangeResponse:
    """Expose the request and response exchanged with the AI pipeline."""
    exchange = scan_service.get_pipeline_exchange(scan_id)
    if exchange is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan not found")
    return exchange


@router.get("/{scan_id}/risk-projection", response_model=ScanRiskProjectionResponse)
def get_scan_risk_projection(
    scan_id: str,
    mode: str = Query(default="final", pattern="^(embedding|final)$"),
) -> ScanRiskProjectionResponse:
    """Return score-aligned risk-space projection for a completed scan."""
    projection = build_scan_projection_response(scan_id=scan_id, mode=mode)
    if projection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan not found")
    return projection
