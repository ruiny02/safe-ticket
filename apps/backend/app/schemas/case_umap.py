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
    x_3d: float | None = None
    y_3d: float | None = None
    z_3d: float | None = None
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
    umap_dimensions: list[int] = Field(default_factory=lambda: [2, 3])
    umap_target: str | None = "risk_score_ordinal"
    umap_target_metric: str | None = "l2"
    umap_target_weight: float | None = None


class CaseUmapResponse(BaseModel):
    """Visualization-ready response for the report/dashboard embedding map."""

    points: list[CaseUmapPoint]
    total_cases: int
    risk_counts: dict[str, int]
    projection: CaseUmapProjection
    current_scan: CaseUmapCurrentScan | None = None
