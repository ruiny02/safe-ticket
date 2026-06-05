"""Case-memory endpoints for dashboard and report visualizations."""

from fastapi import APIRouter, Query

from app.schemas.case_umap import CaseUmapResponse
from app.services.case_umap import build_case_umap


router = APIRouter()


@router.get("/umap", response_model=CaseUmapResponse)
def get_case_umap(
    limit: int = Query(default=500, ge=1, le=2000),
) -> CaseUmapResponse:
    """Return UMAP-ready fraud-memory case points with risk metadata."""
    return build_case_umap(limit=limit)
