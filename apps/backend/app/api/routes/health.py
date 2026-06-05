"""서버 상태 확인용"""

from fastapi import APIRouter, HTTPException, status

from app.db.session import engine
from app.schemas.health import HealthResponse, PipelineHealthResponse
from app.services.pipeline_client import pipeline_client
from sqlalchemy import text


router = APIRouter()


@router.get("/live", response_model=HealthResponse)
def live() -> HealthResponse:
    """Return a simple process-level liveness response."""
    return HealthResponse(status="ok")


@router.get("/ready", response_model=HealthResponse)
def ready() -> HealthResponse:
    """Return readiness only when the configured database is reachable."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database unavailable",
        ) from exc

    return HealthResponse(status="ready")


@router.get("/pipeline", response_model=PipelineHealthResponse)
def pipeline() -> PipelineHealthResponse:
    """Return whether the backend can reach the configured pipeline service."""
    reachable = pipeline_client.health_check()
    return PipelineHealthResponse(
        status="ok" if reachable else "unavailable",
        pipeline_reachable=reachable,
    )
