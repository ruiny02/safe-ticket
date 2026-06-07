import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.db.base import Base
from app.db.models import Case, CaseChunk, CaseEntity, RawPost, SellerObservation
from app.db.session import SessionLocal, engine
from app.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_database() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def build_raw_post_payload() -> dict:
    return {
        "platform": "bungaejangter",
        "source_url": "https://m.bunjang.co.kr/products/412388462",
        "title": "스파이에어 티켓 양도받아요",
        "content": "선입금 후 예매번호 전달합니다. 카톡 safe123 주세요.",
        "price": "98,000원",
        "seller_id": "seller-1",
        "raw_html": "<html><body>raw</body></html>",
        "rendered_text": "스파이에어 JUST LIKE THIS 2026 한국 VIP B구역 양도.",
        "crawled_at": "2026-06-04T13:08:25.186106Z",
        "source_file": "parsed_bungaejangter_0003_f807d5bd4e.json",
        "raw_payload": {
            "platform": "bungaejangter",
            "url": "https://m.bunjang.co.kr/products/412388462",
            "title": "스파이에어 티켓 양도받아요",
        },
    }


def test_create_raw_post_stores_original_payload() -> None:
    response = client.post("/api/v1/raw-posts", json=build_raw_post_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["created"] is True
    assert body["platform"] == "bungaejangter"

    with SessionLocal() as db:
        row = db.get(RawPost, body["raw_post_id"])
        assert row is not None
        assert row.raw_payload["url"] == "https://m.bunjang.co.kr/products/412388462"
        assert row.rendered_text.startswith("스파이에어")


def test_create_raw_post_is_idempotent_by_platform_and_source_url() -> None:
    first = client.post("/api/v1/raw-posts", json=build_raw_post_payload())
    updated_payload = build_raw_post_payload()
    updated_payload["title"] = "업데이트된 원본 제목"
    second = client.post("/api/v1/raw-posts", json=updated_payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["raw_post_id"] == second.json()["raw_post_id"]
    assert second.json()["created"] is False

    with SessionLocal() as db:
        rows = db.query(RawPost).all()
        assert len(rows) == 1
        assert rows[0].title == "업데이트된 원본 제목"


def test_bulk_import_raw_posts_into_case_memory_tables() -> None:
    response = client.post("/api/v1/raw-posts/bulk", json={"items": [build_raw_post_payload()]})
    assert response.status_code == 201

    import_response = client.post("/api/v1/raw-posts/import-cases")
    assert import_response.status_code == 200
    body = import_response.json()
    assert body["raw_posts_seen"] == 1
    assert body["cases_created"] == 1
    assert body["chunks_created"] >= 1
    assert body["entities_created"] >= 2
    assert body["seller_observations_created"] == 1
    assert body["risk_level_counts"] == {"high": 1}

    second_import_response = client.post("/api/v1/raw-posts/import-cases")
    assert second_import_response.status_code == 200
    assert second_import_response.json()["cases_updated"] == 1

    with SessionLocal() as db:
        assert db.query(Case).count() == 1
        case = db.query(Case).one()
        assert case.label == "risk_high"
        assert case.risk_level == "high"
        assert case.risk_score is not None
        assert "payment_flow_high_risk" in case.risk_flags_json
        assert db.query(CaseChunk).count() >= 1
        assert db.query(CaseEntity).count() >= 2
        assert db.query(SellerObservation).count() == 1
