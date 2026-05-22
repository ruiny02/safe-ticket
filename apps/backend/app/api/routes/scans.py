"""Scan-related endpoints for AI pipeline integration."""

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app.schemas.common import MessageResponse
from app.schemas.scan import (
    FeedbackRequest,
    PipelineExchangeResponse,
    ScanCreateRequest,
    ScanCreateResponse,
    ScanResultResponse,
)
from app.services.scan_service import scan_service


router = APIRouter()


@router.post("", response_model=ScanCreateResponse, status_code=status.HTTP_202_ACCEPTED)
def create_scan(payload: ScanCreateRequest, background_tasks: BackgroundTasks) -> ScanCreateResponse:
    """Create a scan job and schedule pipeline processing in the background."""
    # Create the initial scan record that the client can start polling.
    created_scan = scan_service.create_scan(payload)

    # Save the payload that would normally be forwarded to the AI pipeline service.
    scan_service.attach_pipeline_request(created_scan.scan_id, payload)

    # The background task simulates the hand-off from backend to AI pipeline.
    background_tasks.add_task(scan_service.process_scan, created_scan.scan_id)
    return created_scan


@router.get("/{scan_id}", response_model=ScanResultResponse)
def get_scan(scan_id: str) -> ScanResultResponse:
    """Return the current status or finished result of a scan job."""
    scan = scan_service.get_scan(scan_id)
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan not found")
    return scan


@router.post("/{scan_id}/feedback", response_model=MessageResponse)
def save_feedback(scan_id: str, payload: FeedbackRequest) -> MessageResponse:
    """Store user feedback for a scan using an in-memory repository."""
    saved = scan_service.save_feedback(scan_id=scan_id, payload=payload)
    if not saved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan not found")
    return MessageResponse(status="saved")


@router.get("/{scan_id}/pipeline-debug", response_model=PipelineExchangeResponse)
def get_pipeline_debug(scan_id: str) -> PipelineExchangeResponse:
    """Expose the dummy request and response exchanged with the AI pipeline."""
    exchange = scan_service.get_pipeline_exchange(scan_id)
    if exchange is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan not found")
    return exchange
