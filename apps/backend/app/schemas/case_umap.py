"""Schemas for backend-owned case embedding visualizations."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CaseUmapPoint(BaseModel):
    """A single fraud-memory case projected into 2D for visualization."""

    case_id: str
    x: float
    y: float
    title: str | None = None
    summary: str | None = None
    source_url: str | None = None
    platform_hint: str | None = None
    risk_level: str | None = None
    risk_score: float | None = None
    risk_flags: list[str] = Field(default_factory=list)


class CaseUmapProjection(BaseModel):
    """Metadata describing how the coordinates were produced."""

    pipeline: str
    source_embedding: str = "case_chunks.embedding"
    pca_components: int
    umap_neighbors: int | None = None
    umap_min_dist: float | None = None


class CaseUmapResponse(BaseModel):
    """Visualization-ready response for the report/dashboard embedding map."""

    points: list[CaseUmapPoint]
    total_cases: int
    risk_counts: dict[str, int]
    projection: CaseUmapProjection
