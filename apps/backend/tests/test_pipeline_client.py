"""Unit tests for the real backend-side pipeline HTTP client."""

from __future__ import annotations

import httpx
import pytest

from app.schemas.scan import ContentBlock, PipelineOutboundPayload, SellerInfo
from app.services.pipeline_client import (
    PipelineBadStatusError,
    PipelineInvalidResponseError,
    PipelineTimeoutError,
    PipelineUnavailableError,
    pipeline_client,
)


def build_outbound_payload() -> PipelineOutboundPayload:
    """Return a valid outbound payload for client tests."""
    return PipelineOutboundPayload(
        scan_id="scan_test1234",
        platform="joonggonara",
        page_url="https://example.com/post/123",
        page_title="IU concert ticket sale",
        price=120000,
        seller=SellerInfo(seller_id="user123", nickname="ticketmaster"),
        content_blocks=[
            ContentBlock(
                block_id="title",
                text="Transfer me first and I will send the ticket after payment.",
            )
        ],
    )


def test_pipeline_client_parses_valid_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure a valid 200 response is converted into the expected schema."""

    def mock_post(self: httpx.Client, *args, **kwargs) -> httpx.Response:
        request = httpx.Request("POST", "http://pipeline:8010/api/v1/analyze")
        return httpx.Response(
            200,
            request=request,
            json={
                "risk_level": "high",
                "risk_score": 0.87,
                "summary": "Valid mocked pipeline response.",
                "risk_tags": ["avoid_safe_payment"],
                "evidence_items": [],
                "highlight_targets": [],
                "similar_cases": [],
                "recommended_actions": [],
                "degraded": False,
            },
        )

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    response = pipeline_client.analyze(build_outbound_payload())
    assert response.risk_level == "high"
    assert response.summary == "Valid mocked pipeline response."


def test_pipeline_client_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure transport timeouts map to a stable backend exception."""

    def mock_post(self: httpx.Client, *args, **kwargs) -> httpx.Response:
        request = httpx.Request("POST", "http://pipeline:8010/api/v1/analyze")
        raise httpx.TimeoutException("timeout", request=request)

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    with pytest.raises(PipelineTimeoutError):
        pipeline_client.analyze(build_outbound_payload())


def test_pipeline_client_connection_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure network failures map to an unavailable-pipeline exception."""

    def mock_post(self: httpx.Client, *args, **kwargs) -> httpx.Response:
        request = httpx.Request("POST", "http://pipeline:8010/api/v1/analyze")
        raise httpx.ConnectError("offline", request=request)

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    with pytest.raises(PipelineUnavailableError):
        pipeline_client.analyze(build_outbound_payload())


def test_pipeline_client_bad_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure non-2xx responses map to a bad-status pipeline exception."""

    def mock_post(self: httpx.Client, *args, **kwargs) -> httpx.Response:
        request = httpx.Request("POST", "http://pipeline:8010/api/v1/analyze")
        return httpx.Response(503, request=request, json={"detail": "temporarily unavailable"})

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    with pytest.raises(PipelineBadStatusError):
        pipeline_client.analyze(build_outbound_payload())


def test_pipeline_client_invalid_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure malformed response bodies map to an invalid-response exception."""

    def mock_post(self: httpx.Client, *args, **kwargs) -> httpx.Response:
        request = httpx.Request("POST", "http://pipeline:8010/api/v1/analyze")
        return httpx.Response(
            200,
            request=request,
            json={
                "risk_level": "high",
                "summary": "Missing required fields on purpose.",
            },
        )

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    with pytest.raises(PipelineInvalidResponseError):
        pipeline_client.analyze(build_outbound_payload())
