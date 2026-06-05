"""API tests that verify backend behavior around real pipeline integration."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

from fastapi.testclient import TestClient
import pytest

from app.db.base import Base
from app.db.session import engine
from app.main import app
from app.schemas.scan import (
    EvidenceItem,
    PipelineInboundPayload,
    RecommendedAction,
    SimilarCase,
)
from app.repositories.db_store import db_store
from app.services import pipeline_client as pipeline_client_module
from app.services.pipeline_client import PipelineUnavailableError


# The shared test client exercises the API without starting a real server.
client = TestClient(app)


def build_scan_payload() -> dict:
    """Return a stable payload that matches the documented scan input shape."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/123",
        "page_title": "IU concert ticket sale",
        "price": 120000,
        "seller": {
            "seller_id": "user123",
            "nickname": "ticketmaster",
        },
        "content_blocks": [
            {
                "block_id": "title",
                "text": "Transfer me first and I will send the ticket after payment.",
            },
            {
                "block_id": "body-1",
                "text": "Please move to messenger for faster communication.",
            },
        ],
    }


def build_pipeline_result() -> PipelineInboundPayload:
    """Return a valid pipeline response payload for mocked success cases."""
    highlight_items = [
        EvidenceItem(
            block_id="title",
            start=0,
            end=17,
            matched_text="Transfer me first",
            reason_code="avoid_safe_payment",
            reason="Mocked risky phrase match.",
        ),
        EvidenceItem(
            block_id="body-1",
            start=15,
            end=24,
            matched_text="messenger",
            reason_code="off_platform_contact",
            reason="Mocked off-platform contact match.",
        ),
    ]

    return PipelineInboundPayload(
        risk_level="high",
        risk_score=0.87,
        summary="Mocked pipeline response for API testing.",
        risk_tags=["avoid_safe_payment", "off_platform_contact"],
        evidence_items=highlight_items,
        highlight_targets=highlight_items,
        similar_cases=[
            SimilarCase(
                case_id="case_123",
                score=0.81,
                summary="Mocked similar case from the pipeline.",
            )
        ],
        recommended_actions=[
            RecommendedAction(
                action="use_safe_payment",
                description="Use the marketplace's protected payment flow.",
            )
        ],
        degraded=False,
    )


@pytest.fixture(autouse=True)
def reset_database() -> None:
    """Rebuild test tables so each API test starts from empty persisted state."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_scan_flow_and_pipeline_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure a successful pipeline call completes the scan and stores the exchange."""
    observed_statuses: list[str] = []

    def mock_analyze(outbound_payload, *_args, **_kwargs) -> PipelineInboundPayload:
        scan = db_store.get_scan(outbound_payload.scan_id)
        assert scan is not None
        observed_statuses.append(scan.status)
        return build_pipeline_result()

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)

    create_response = client.post("/api/v1/scans", json=build_scan_payload())
    assert create_response.status_code == 202

    scan_id = create_response.json()["scan_id"]

    # Poll the completed result after the mocked pipeline call returns successfully.
    scan_response = client.get(f"/api/v1/scans/{scan_id}")
    assert scan_response.status_code == 200
    scan_body = scan_response.json()
    assert scan_body["status"] == "completed"
    assert len(scan_body["highlight_targets"]) == 2
    assert observed_statuses == ["processing"]

    # Inspect the exact outbound and inbound payloads used for pipeline integration.
    debug_response = client.get(f"/api/v1/scans/{scan_id}/pipeline-debug")
    assert debug_response.status_code == 200
    debug_body = debug_response.json()
    assert debug_body["outbound_payload"]["scan_id"] == scan_id
    assert debug_body["inbound_payload"]["risk_level"] == "high"
    assert debug_body["pipeline_error"] is None


def test_scan_list_endpoint_returns_recent_scans(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure the list endpoint returns compact scan summaries for history screens."""

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
        return build_pipeline_result()

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)

    first_response = client.post("/api/v1/scans", json=build_scan_payload())
    second_payload = build_scan_payload()
    second_payload["page_title"] = "Baseball ticket sale"
    second_response = client.post("/api/v1/scans", json=second_payload)

    assert first_response.status_code == 202
    assert second_response.status_code == 202

    list_response = client.get("/api/v1/scans?limit=10&offset=0")

    assert list_response.status_code == 200
    body = list_response.json()
    assert body["total"] == 2
    assert body["limit"] == 10
    assert body["offset"] == 0
    assert {item["scan_id"] for item in body["items"]} == {
        first_response.json()["scan_id"],
        second_response.json()["scan_id"],
    }
    assert all(item["status"] == "completed" for item in body["items"])


def test_scan_uses_imported_case_memory_for_similar_cases(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure scan results can point at cases imported from raw_posts."""

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
        result = build_pipeline_result()
        result.similar_cases = [
            SimilarCase(
                case_id="rule_based_reference_001",
                score=0.72,
                summary="Placeholder case from pipeline.",
            )
        ]
        return result

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)

    raw_payload = {
        "platform": "joonggonara",
        "source_url": "https://web.joongna.com/product/229310133",
        "title": "2026 이승기 콘서트 티켓양도",
        "content": "이승기 콘서트 티켓 양도합니다. 선입금 후 모바일티켓 전달.",
        "price": "170,000원",
        "raw_payload": {"url": "https://web.joongna.com/product/229310133"},
    }
    assert client.post("/api/v1/raw-posts", json=raw_payload).status_code == 201
    assert client.post("/api/v1/raw-posts/import-cases").status_code == 200

    scan_payload = build_scan_payload()
    scan_payload["page_title"] = "2026 이승기 콘서트 티켓양도"
    scan_payload["content_blocks"] = [
        {
            "block_id": "body-1",
            "text": "이승기 콘서트 티켓 양도 관련해서 모바일티켓 전달 가능한가요?",
        }
    ]

    create_response = client.post("/api/v1/scans", json=scan_payload)
    assert create_response.status_code == 202

    scan_response = client.get(f"/api/v1/scans/{create_response.json()['scan_id']}")
    assert scan_response.status_code == 200
    similar_cases = scan_response.json()["similar_cases"]
    assert similar_cases
    assert similar_cases[0]["case_id"].startswith("case_")
    assert similar_cases[0]["case_id"] != "rule_based_reference_001"


def test_failed_pipeline_marks_scan_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure pipeline failures surface as failed scans instead of crashing the API."""

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
        raise PipelineUnavailableError()

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)

    create_response = client.post("/api/v1/scans", json=build_scan_payload())
    assert create_response.status_code == 202
    scan_id = create_response.json()["scan_id"]

    scan_response = client.get(f"/api/v1/scans/{scan_id}")
    assert scan_response.status_code == 200
    assert scan_response.json()["status"] == "failed"

    debug_response = client.get(f"/api/v1/scans/{scan_id}/pipeline-debug")
    assert debug_response.status_code == 200
    assert debug_response.json()["pipeline_error"]["error_type"] == "pipeline_unavailable"


def test_pipeline_health_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure the health endpoint exposes backend-to-pipeline reachability."""
    monkeypatch.setattr(pipeline_client_module.pipeline_client, "health_check", lambda: True)

    response = client.get("/api/v1/health/pipeline")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "pipeline_reachable": True}
