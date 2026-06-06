"""Schemas for backend-owned case embedding visualizations."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CaseUmapPoint(BaseModel):
    """A single fraud-memory case or current scan projected into 3D."""

    case_id: str
    label: str
    x: float
    y: float
    z: float
    variant: str
    summary: str | None = None
    source_url: str | None = None
    platform_hint: str | None = None
    risk_level: str | None = None
    risk_score: float | None = None
    risk_flags: list[str] = Field(default_factory=list)


class CaseUmapCurrentScan(BaseModel):
    """Cluster distance summary for the current scan overlay."""

    scan_id: str
    nearest_cluster: str
    distances: dict[str, float]


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
    current_scan: CaseUmapCurrentScan | None = None
