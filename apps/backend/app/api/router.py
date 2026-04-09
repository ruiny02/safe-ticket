"""Top-level API router registration."""

from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.scans import router as scans_router


# The shared router keeps versioned route registration in one place.
api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(scans_router, prefix="/scans", tags=["scans"])
