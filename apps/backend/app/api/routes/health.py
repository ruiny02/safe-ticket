"""서버 상태 확인용"""

from fastapi import APIRouter

from app.schemas.health import HealthResponse


router = APIRouter()


@router.get("/live", response_model=HealthResponse)
def live() -> HealthResponse:
    """Return a simple process-level liveness response."""
    return HealthResponse(status="ok")


@router.get("/ready", response_model=HealthResponse)
def ready() -> HealthResponse:
    """Return a simple readiness response for local development."""
    return HealthResponse(status="ready")
