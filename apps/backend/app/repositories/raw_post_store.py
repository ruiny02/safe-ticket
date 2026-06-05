"""Persistence helpers for raw marketplace crawler output."""

from __future__ import annotations

import hashlib
import json

from app.db.models import RawPost
from app.db.session import SessionLocal
from app.schemas.raw_post import RawPostCreateRequest, RawPostResponse


def build_raw_post_id(payload: RawPostCreateRequest) -> str:
    """Build a stable id so repeated uploads refresh the same raw post."""
    if payload.raw_post_id:
        return payload.raw_post_id

    identity = f"{payload.platform}:{payload.source_url}"
    if not payload.source_url:
        identity = json.dumps(payload.raw_payload, ensure_ascii=False, sort_keys=True)

    return f"raw_{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:24]}"


class RawPostStore:
    """Small repository used by raw ingest endpoints."""

    def upsert_raw_post(self, payload: RawPostCreateRequest) -> RawPostResponse:
        raw_post_id = build_raw_post_id(payload)

        with SessionLocal() as db:
            row = db.get(RawPost, raw_post_id)
            created = row is None

            if row is None:
                row = RawPost(raw_post_id=raw_post_id)
                db.add(row)

            row.platform = payload.platform
            row.source_url = payload.source_url
            row.title = payload.title
            row.content = payload.content
            row.price = payload.price
            row.seller_id = payload.seller_id
            row.raw_html = payload.raw_html
            row.rendered_text = payload.rendered_text
            row.raw_payload = payload.raw_payload
            row.ingest_source = payload.ingest_source
            row.source_file = payload.source_file
            row.crawled_at = payload.crawled_at

            db.commit()
            db.refresh(row)
            return self._response_from_row(row, created=created)

    def upsert_many(self, payloads: list[RawPostCreateRequest]) -> list[RawPostResponse]:
        return [self.upsert_raw_post(payload) for payload in payloads]

    def _response_from_row(self, row: RawPost, created: bool) -> RawPostResponse:
        return RawPostResponse(
            raw_post_id=row.raw_post_id,
            created=created,
            platform=row.platform,
            source_url=row.source_url,
            title=row.title,
            crawled_at=row.crawled_at,
        )


raw_post_store = RawPostStore()
