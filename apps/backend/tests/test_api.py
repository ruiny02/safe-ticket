"""API tests that verify backend behavior around real pipeline integration."""

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.repositories.in_memory import store
from app.schemas.scan import (
    EvidenceItem,
    PipelineInboundPayload,
    RecommendedAction,
    SimilarCase,
)
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
def reset_store() -> None:
    """Clear shared in-memory state before each test."""
    store.clear()


def test_scan_flow_and_pipeline_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure a successful pipeline call completes the scan and stores the exchange."""

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
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

    # Inspect the exact outbound and inbound payloads used for pipeline integration.
    debug_response = client.get(f"/api/v1/scans/{scan_id}/pipeline-debug")
    assert debug_response.status_code == 200
    debug_body = debug_response.json()
    assert debug_body["outbound_payload"]["scan_id"] == scan_id
    assert debug_body["inbound_payload"]["risk_level"] == "high"
    assert debug_body["pipeline_error"] is None


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


def test_feedback_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure the feedback API behaves as expected after scan creation."""

    def mock_analyze(*_args, **_kwargs) -> PipelineInboundPayload:
        return build_pipeline_result()

    monkeypatch.setattr(pipeline_client_module.pipeline_client, "analyze", mock_analyze)

    create_response = client.post("/api/v1/scans", json=build_scan_payload())
    scan_id = create_response.json()["scan_id"]

    feedback_response = client.post(
        f"/api/v1/scans/{scan_id}/feedback",
        json={"feedback_type": "helpful", "comment": "The pipeline-backed response is easy to inspect."},
    )
    assert feedback_response.status_code == 200
    assert feedback_response.json()["status"] == "saved"
