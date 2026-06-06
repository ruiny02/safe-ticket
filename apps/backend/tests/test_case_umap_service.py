"""Tests for backend-owned case UMAP projection data."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

import pytest

from app.db.base import Base
from app.db.models import Case, CaseChunk, Scan
from app.db.session import SessionLocal, engine
from app.services.case_umap import build_case_umap


@pytest.fixture(autouse=True)
def reset_database() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def seed_case(case_id: str, risk_level: str, risk_score: float, embedding: list[float]) -> None:
    with SessionLocal() as db:
        case = Case(
            case_id=case_id,
            source_type="marketplace_crawl",
            source_url=f"https://example.com/{case_id}",
            title=f"{case_id} ticket sale",
            body=f"{case_id} suspicious ticket listing",
            label="fraud_memory",
            summary=f"{case_id} summary",
            platform_hint="bunjang",
            risk_level=risk_level,
            risk_score=risk_score,
            risk_flags_json=["ticket_delivery_risk", "refund_denial"],
        )
        case.chunks = [
            CaseChunk(
                chunk_order=0,
                chunk_text=case.body,
                embedding=embedding,
            )
        ]
        db.add(case)
        db.commit()


def test_build_case_umap_returns_risk_colored_projection_points() -> None:
    seed_case("case_high", "high", 0.36, [0.9, 0.1, 0.0, 0.0])
    seed_case("case_medium_a", "medium", 0.26, [0.7, 0.2, 0.1, 0.0])
    seed_case("case_medium_b", "medium", 0.24, [0.6, 0.3, 0.1, 0.0])
    seed_case("case_low", "low", 0.03, [0.0, 0.1, 0.8, 0.1])

    result = build_case_umap(limit=10)

    assert result.total_cases == 4
    assert result.risk_counts == {"fraud": 1, "borderline": 2, "safe": 1}
    assert result.projection.pipeline == "case_chunks.embedding mean -> PCA(<=50) -> UMAP(3)"

    high_point = next(point for point in result.points if point.case_id == "case_high")
    assert high_point.label == "case_high ticket sale"
    assert high_point.variant == "fraud"
    assert high_point.risk_level == "high"
    assert high_point.risk_score == 0.36
    assert high_point.risk_flags == ["ticket_delivery_risk", "refund_denial"]
    assert isinstance(high_point.x, float)
    assert isinstance(high_point.y, float)
    assert isinstance(high_point.z, float)
    assert all(8 <= point.x <= 92 and 8 <= point.y <= 92 and 8 <= point.z <= 92 for point in result.points)


def test_build_case_umap_excludes_cases_without_embeddings() -> None:
    with SessionLocal() as db:
        db.add(
            Case(
                case_id="case_without_embedding",
                source_type="marketplace_crawl",
                title="No embedding",
                body="No embedding body",
                risk_level="medium",
                risk_score=0.2,
                risk_flags_json=["verification_only_claim"],
            )
        )
        db.commit()

    result = build_case_umap(limit=10)

    assert result.total_cases == 0
    assert result.points == []
    assert result.risk_counts == {"fraud": 0, "borderline": 0, "safe": 0}


def test_build_case_umap_adds_current_scan_overlay_from_similar_cases() -> None:
    seed_case("case_high", "high", 0.36, [0.9, 0.1, 0.0, 0.0])
    seed_case("case_low", "low", 0.03, [0.0, 0.1, 0.8, 0.1])

    with SessionLocal() as db:
        db.add(
            Scan(
                scan_id="scan_current",
                platform="joonggonara",
                page_url="https://example.com/post",
                page_title="current post",
                price=120000,
                status="completed",
                similar_cases_json=[
                    {"case_id": "case_high", "score": 0.95, "summary": "near fraud"},
                ],
            )
        )
        db.commit()

    result = build_case_umap(limit=10, scan_id="scan_current")

    assert result.total_cases == 2
    assert result.current_scan is not None
    assert result.current_scan.nearest_cluster == "fraud"
    current_point = next(point for point in result.points if point.case_id == "scan_current")
    assert current_point.variant == "current"
    assert isinstance(current_point.z, float)
