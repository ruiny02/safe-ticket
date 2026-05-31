"""External fraud lookup endpoints."""

from fastapi import APIRouter

from app.schemas.external_lookup import ExternalLookupRequest, ExternalLookupResponse
from app.services.external_lookup import ExternalLookupError, external_lookup_service


router = APIRouter()


@router.post("", response_model=ExternalLookupResponse)
def create_external_lookup(payload: ExternalLookupRequest) -> ExternalLookupResponse:
    """Run an external lookup for a parsed phone or account number."""
    try:
        return external_lookup_service.lookup(payload)
    except ExternalLookupError as exc:
        return ExternalLookupResponse(
            provider=payload.provider,
            kind=payload.kind,
            keyword=payload.keyword,
            status="failed",
            message=str(exc),
            source_url="",
            risk_found=None,
        )
