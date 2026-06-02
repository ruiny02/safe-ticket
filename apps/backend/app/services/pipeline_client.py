"""HTTP client used by the backend to call the external AI pipeline service."""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from app.core.config import get_settings
from app.schemas.scan import PipelineInboundPayload, PipelineOutboundPayload, ScanCreateRequest


@dataclass
class PipelineClientError(Exception):
    """Base exception for backend-side pipeline integration failures."""

    # The error type is stored so the service layer can expose a stable failure reason.
    error_type: str
    message: str
    retryable: bool
    status_code: int | None = None

    def __str__(self) -> str:
        """Return the human-readable pipeline error message."""
        return self.message


class PipelineTimeoutError(PipelineClientError):
    """Raised when the pipeline does not respond before the configured timeout."""

    def __init__(self) -> None:
        super().__init__(
            error_type="pipeline_timeout",
            message="The pipeline request timed out.",
            retryable=True,
        )


class PipelineUnavailableError(PipelineClientError):
    """Raised when the backend cannot reach the pipeline service."""

    def __init__(self) -> None:
        super().__init__(
            error_type="pipeline_unavailable",
            message="The pipeline service is unavailable.",
            retryable=True,
        )


class PipelineBadStatusError(PipelineClientError):
    """Raised when the pipeline returns a non-success HTTP status code."""

    def __init__(self, status_code: int) -> None:
        super().__init__(
            error_type="pipeline_bad_status",
            message=f"The pipeline returned HTTP {status_code}.",
            retryable=status_code >= 500,
            status_code=status_code,
        )


class PipelineInvalidResponseError(PipelineClientError):
    """Raised when the pipeline responds with invalid JSON or schema fields."""

    def __init__(self) -> None:
        super().__init__(
            error_type="pipeline_invalid_response",
            message="The pipeline returned an invalid response payload.",
            retryable=False,
        )


class PipelineClient:
    """Build outbound payloads and send them to the configured pipeline endpoint."""

    def health_check(self) -> bool:
        """Return whether the configured pipeline service is reachable."""
        settings = get_settings()
        request_url = f"{settings.pipeline_base_url.rstrip('/')}/health"

        try:
            with httpx.Client(timeout=settings.pipeline_timeout_seconds) as client:
                response = client.get(request_url)
                response.raise_for_status()
        except (httpx.TimeoutException, httpx.RequestError, httpx.HTTPStatusError):
            return False

        return True

    def build_outbound_payload(self, scan_id: str, payload: ScanCreateRequest) -> PipelineOutboundPayload:
        """Transform the API request into the pipeline-facing payload shape."""
        return PipelineOutboundPayload(
            scan_id=scan_id,
            platform=payload.platform,
            page_url=payload.page_url,
            page_title=payload.page_title,
            price=payload.price,
            seller=payload.seller,
            content_blocks=payload.content_blocks,
            marketplace_signals=payload.marketplace_signals,
        )

    def analyze(self, outbound_payload: PipelineOutboundPayload) -> PipelineInboundPayload:
        """Send the outbound payload to the configured pipeline endpoint and validate the reply."""
        settings = get_settings()
        request_url = f"{settings.pipeline_base_url.rstrip('/')}{settings.pipeline_analyze_path}"
        headers = {"Content-Type": "application/json"}

        # Support an optional internal API key without requiring auth in local development.
        if settings.pipeline_api_key:
            headers["X-Internal-API-Key"] = settings.pipeline_api_key

        try:
            with httpx.Client(timeout=settings.pipeline_timeout_seconds) as client:
                response = client.post(
                    request_url,
                    json=outbound_payload.model_dump(mode="json"),
                    headers=headers,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise PipelineTimeoutError() from exc
        except httpx.HTTPStatusError as exc:
            raise PipelineBadStatusError(status_code=exc.response.status_code) from exc
        except httpx.RequestError as exc:
            raise PipelineUnavailableError() from exc

        try:
            response_body = response.json()
        except ValueError as exc:
            raise PipelineInvalidResponseError() from exc

        try:
            # Validate the pipeline response before the rest of the backend consumes it.
            return PipelineInboundPayload.model_validate(response_body)
        except ValidationError as exc:
            raise PipelineInvalidResponseError() from exc


# A module-level client instance keeps service imports small and test patching easy.
pipeline_client = PipelineClient()
