"""Top-level API router registration."""

from fastapi import APIRouter

from app.api.routes.chat import router as chat_router
from app.api.routes.external_lookups import router as external_lookups_router
from app.api.routes.health import router as health_router
from app.api.routes.raw_posts import router as raw_posts_router
from app.api.routes.scans import router as scans_router


# The shared router keeps versioned route registration in one place.
api_router = APIRouter()
api_router.include_router(chat_router, prefix="/chat", tags=["chat"])
api_router.include_router(external_lookups_router, prefix="/external-lookups", tags=["external-lookups"])
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(raw_posts_router, prefix="/raw-posts", tags=["raw-posts"])
api_router.include_router(scans_router, prefix="/scans", tags=["scans"])
