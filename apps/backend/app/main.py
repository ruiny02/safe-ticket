"""Application entry point for the FastAPI backend."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    """FastAPI 객체 생성 및 설정값 읽기"""
    settings = get_settings()

    # The FastAPI app holds the public metadata shown in docs and OpenAPI.
    app = FastAPI(
        title=settings.project_name,
        version="0.1.0",
        description="Backend API scaffold for Safe Ticket AI pipeline integration.",
    )

    # CORS lets the future web app and browser extension call the backend safely.
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Register all versioned API routes under a single router tree.
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    return app


# Uvicorn imports this variable when we run `uvicorn app.main:app`.
app = create_app()
