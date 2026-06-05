"""Schemas used by the health endpoints."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Health-check response shared by live and ready endpoints."""

    # The status string is intentionally tiny for simple monitoring.
    status: str


class PipelineHealthResponse(BaseModel):
    """Health-check response for backend-to-pipeline connectivity."""

    status: str
    pipeline_reachable: bool
