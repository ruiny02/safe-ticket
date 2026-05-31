"""Tests for automatic external lookups inside scan processing."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.db.base import Base
from app.db.session import engine
from app.main import app
from app.schemas.external_lookup import ExternalLookupResponse
from app.schemas.scan import PipelineInboundPayload
from app.services import pipeline_client as pipeline_client_module
from app.services import scan_service as scan_service_module
from app.services.external_lookup import ExternalLookupError


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_database() -> None:
    """Rebuild test tables so each test starts from empty persisted state."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def build_scan_payload() -> dict:
    """Return a scan payload containing repeated phone and account candidates."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/product/123",
        "page_title": "tuki concert ticket sale",
        "price": 163000,
        "seller": {"seller_id": "seller-1", "nickname": "낭닥SJ"},
        "content_blocks": [
            {
                "block_id": "body-1",
                "text": "입금 은행 : 카카오뱅크\n계좌 번호 : 3355-28-8620726\n연락처 010-4112-0302",
            },
            {
                "block_id": "body-2",
                "text": "연락은 01041120302로 주세요. 가격은 163000원입니다.",
            },
        ],
    }


def build_pipeline_result() -> PipelineInboundPayload:
    """Return a minimal completed pipeline result."""
    return PipelineInboundPayload(
        risk_level="high",
        risk_score=0.87,
        summary="pipeline completed",
        risk_tags=["bank_account_pattern"],
        evidence_items=[],
        highlight_targets=[],
        similar_cases=[],
        recommended_actions=[],
        degraded=False,
    )


def test_scan_result_includes_external_lookup_results(monkeypatch: pytest.MonkeyPatch) -> None:
    """Completed scans should include police and TheCheat lookup results for parsed candidates."""
    captured_requests: list[tuple[str, str, str]] = []

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
        return build_pipeline_result()

    def mock_lookup(payload) -> ExternalLookupResponse:
        captured_requests.append((payload.provider, payload.kind, payload.keyword))
        return ExternalLookupResponse(
            provider=payload.provider,
            kind=payload.kind,
            keyword=payload.keyword,
            status="completed",
            message="lookup completed",
            source_url="https://example.com/lookup",
            report_count=0 if payload.provider == "police" else None,
            risk_found=False if payload.provider == "police" else None,
        )

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)
    monkeypatch.setattr(scan_service_module.external_lookup_service, "lookup", mock_lookup)

    create_response = client.post("/api/v1/scans", json=build_scan_payload())
    assert create_response.status_code == 202

    scan_id = create_response.json()["scan_id"]
    scan_response = client.get(f"/api/v1/scans/{scan_id}")

    assert scan_response.status_code == 200
    scan_body = scan_response.json()
    assert scan_body["status"] == "completed"
    assert {result["provider"] for result in scan_body["external_lookup_results"]} == {"police", "thecheat"}
    assert {result["kind"] for result in scan_body["external_lookup_results"]} == {"account", "phone"}
    assert len(scan_body["external_lookup_results"]) == 4
    assert set(captured_requests) == {
        ("police", "account", "3355288620726"),
        ("thecheat", "account", "3355288620726"),
        ("police", "phone", "01041120302"),
        ("thecheat", "phone", "01041120302"),
    }


def test_external_lookup_failure_does_not_fail_scan(monkeypatch: pytest.MonkeyPatch) -> None:
    """External lookup provider failures should be stored as failed lookup rows only."""

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
        return build_pipeline_result()

    def mock_lookup(payload) -> ExternalLookupResponse:
        if payload.provider == "thecheat":
            raise ExternalLookupError("더치트 조회 실패")
        return ExternalLookupResponse(
            provider=payload.provider,
            kind=payload.kind,
            keyword=payload.keyword,
            status="completed",
            message="police lookup completed",
            source_url="https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
            report_count=0,
            risk_found=False,
        )

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)
    monkeypatch.setattr(scan_service_module.external_lookup_service, "lookup", mock_lookup)

    create_response = client.post("/api/v1/scans", json=build_scan_payload())
    scan_id = create_response.json()["scan_id"]
    scan_response = client.get(f"/api/v1/scans/{scan_id}")

    assert scan_response.status_code == 200
    scan_body = scan_response.json()
    assert scan_body["status"] == "completed"
    failed_lookups = [result for result in scan_body["external_lookup_results"] if result["status"] == "failed"]
    assert len(failed_lookups) == 2
    assert {result["provider"] for result in failed_lookups} == {"thecheat"}
    assert all("더치트 조회 실패" in result["message"] for result in failed_lookups)
