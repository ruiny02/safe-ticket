"""Case-memory endpoints for dashboard and report visualizations."""

from fastapi import APIRouter, Query

from app.schemas.case_umap import CaseUmapResponse
from app.schemas.risk_map import RiskMapResponse
from app.services.case_umap import build_case_umap
from app.services.risk_space.service import build_risk_map_response


router = APIRouter()


@router.get("/umap", response_model=CaseUmapResponse)
def get_case_umap(
    limit: int = Query(default=500, ge=1, le=2000),
    scan_id: str | None = Query(default=None),
    refresh: bool = Query(default=False),
) -> CaseUmapResponse:
    """Return UMAP-ready fraud-memory case points with risk metadata."""
    return build_case_umap(limit=limit, scan_id=scan_id, refresh=refresh)


@router.get("/risk-map", response_model=RiskMapResponse)
def get_case_risk_map(
    dim: int = Query(default=2, ge=2, le=3),
    mode: str = Query(default="embedding", pattern="^(embedding|final)$"),
    reducer: str = Query(default="umap", pattern="^(pca|umap)$"),
    projection: str = Query(default="pls7_umap", pattern="^(pls7_umap|score_aligned)$"),
    limit: int = Query(default=200, ge=1, le=2000),
    scan_id: str | None = Query(default=None),
) -> RiskMapResponse:
    """Return risk-aware 2D/3D case projection points."""
    return build_risk_map_response(
        dim=dim,
        mode=mode,
        reducer=reducer,
        projection=projection,
        limit=limit,
        scan_id=scan_id,
    )
