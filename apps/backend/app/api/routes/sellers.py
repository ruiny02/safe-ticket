"""Seller profile context report endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.repositories.db_store import db_store
from app.schemas.seller import SellerContextReportRequest, SellerContextReportResponse
from app.services.seller_context_report import SellerContextReportError, seller_context_report_service
from app.services.seller_profile_fetcher import SellerProfileFetchError, seller_profile_fetcher


router = APIRouter()


@router.post("/context-report", response_model=SellerContextReportResponse)
def create_seller_context_report(payload: SellerContextReportRequest) -> SellerContextReportResponse:
    """Compare a seller profile URL with the current scan result and evidence."""
    scan_result = db_store.get_scan(payload.scan_id)
    if scan_result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan not found")
    if scan_result.status != "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="scan is not completed")

    exchange = db_store.get_pipeline_exchange(payload.scan_id)
    if exchange is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scan pipeline payload not found")

    try:
        profile = seller_profile_fetcher.fetch(str(payload.profile_url))
    except SellerProfileFetchError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    try:
        return seller_context_report_service.create_report(
            scan_result=scan_result,
            outbound_payload=exchange.outbound_payload,
            profile=profile,
        )
    except SellerContextReportError:
        return seller_context_report_service.create_backend_fallback(
            scan_result=scan_result,
            outbound_payload=exchange.outbound_payload,
            profile=profile,
        )
