"""Endpoints for storing and importing raw marketplace crawler output."""

from fastapi import APIRouter, Query, status

from app.repositories.raw_post_store import raw_post_store
from app.schemas.raw_post import (
    RawPostBulkRequest,
    RawPostBulkResponse,
    RawPostCreateRequest,
    RawPostImportResponse,
    RawPostResponse,
)
from app.services.raw_post_importer import import_raw_posts_to_cases


router = APIRouter()


@router.post("", response_model=RawPostResponse, status_code=status.HTTP_201_CREATED)
def create_raw_post(payload: RawPostCreateRequest) -> RawPostResponse:
    """Store one raw post for later backend-owned LLM and embedding processing."""
    return raw_post_store.upsert_raw_post(payload)


@router.post("/bulk", response_model=RawPostBulkResponse, status_code=status.HTTP_201_CREATED)
def create_raw_posts_bulk(payload: RawPostBulkRequest) -> RawPostBulkResponse:
    """Store raw posts collected by the local pipeline in a single request."""
    items = raw_post_store.upsert_many(payload.items)
    created = sum(1 for item in items if item.created)
    return RawPostBulkResponse(
        total=len(items),
        created=created,
        updated=len(items) - created,
        items=items,
    )


@router.post("/import-cases", response_model=RawPostImportResponse)
def import_raw_posts(
    limit: int | None = Query(default=None, ge=1),
) -> RawPostImportResponse:
    """Convert stored raw posts into cases, chunks, entities, and seller observations."""
    return import_raw_posts_to_cases(limit=limit)
