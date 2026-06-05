"""API tests for case UMAP visualization data."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.db.base import Base
from app.db.models import Case, CaseChunk
from app.db.session import SessionLocal, engine
from app.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_database() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def seed_cases() -> None:
    with SessionLocal() as db:
        for index, (risk_level, risk_score) in enumerate(
            [
                ("high", 0.36),
                ("medium", 0.26),
                ("medium", 0.24),
                ("low", 0.03),
            ],
            start=1,
        ):
            case = Case(
                case_id=f"case_{index}",
                source_type="marketplace_crawl",
                source_url=f"https://example.com/case_{index}",
                title=f"ticket listing {index}",
                body=f"ticket body {index}",
                label="fraud_memory",
                summary=f"summary {index}",
                platform_hint="bunjang",
                risk_level=risk_level,
                risk_score=risk_score,
                risk_flags_json=["ticket_delivery_risk"],
            )
            case.chunks = [
                CaseChunk(
                    chunk_order=0,
                    chunk_text=case.body,
                    embedding=[float(index), float(index % 2), 0.2, 0.4],
                )
            ]
            db.add(case)
        db.commit()


def test_cases_umap_endpoint_returns_visualization_ready_points() -> None:
    seed_cases()

    response = client.get("/api/v1/cases/umap")

    assert response.status_code == 200
    body = response.json()
    assert body["total_cases"] == 4
    assert body["risk_counts"] == {"high": 1, "medium": 2, "low": 1}
    assert body["projection"]["source_embedding"] == "case_chunks.embedding"

    first_point = body["points"][0]
    assert {"case_id", "x", "y", "title", "risk_level", "risk_score", "risk_flags"}.issubset(
        first_point.keys()
    )
    assert first_point["risk_flags"] == ["ticket_delivery_risk"]
