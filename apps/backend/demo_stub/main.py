"""Temporary FastAPI backend used only for demo scan payload verification."""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from apps.backend.demo_stub.schemas import ScanCreateRequest, ScanQueuedResponse

logger = logging.getLogger("safe_ticket.demo_stub")


def _allowed_origins() -> list[str]:
    raw = os.getenv(
        "BACKEND_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _allowed_origin_regex() -> str:
    return r"^chrome-extension://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?$"


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting temporary demo FastAPI stub")
    yield


app = FastAPI(title="safe-ticket demo stub", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_origin_regex=_allowed_origin_regex(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health/live")
def live_health():
    return {"status": "ok"}


@app.post("/api/v1/scans", response_model=ScanQueuedResponse)
def create_scan(request: ScanCreateRequest):
    logger.info("Received demo scan payload: %s", request.model_dump())

    response = ScanQueuedResponse(
        scan_id=f"scan_{int(time.time() * 1000)}",
        status="queued",
        poll_after_ms=2000,
    )
    return JSONResponse(status_code=202, content=response.model_dump())
