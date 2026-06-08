"""Schemas for score-aligned risk-space projections."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


RiskMapMode = Literal["embedding", "final"]
RiskMapDimension = Literal[2, 3]


class RiskMapNeighbor(BaseModel):
    """Nearest historical case in risk-aware latent space."""

    case_id: str
    label: str
    cosine_similarity: float
    weighted_contribution: float
    title: str | None = None
    platform: str | None = None


class RiskMapPoint(BaseModel):
    """One visualization point in 2D or 3D."""

    case_id: str
    label: Literal["safe", "borderline", "fraud", "current"]
    score: float
    x: float
    y: float
    z: float | None = None
    embedding_risk_score: float
    final_score_source: str = "embedding_score"
    title: str | None = None
    platform: str | None = None
    summary: str | None = None


class RiskMapResponse(BaseModel):
    """Historical case projection response."""

    model_version: str
    projection_type: str = "score_aligned_pls_residual_map_v1"
    mode: RiskMapMode
    score_aligned: bool = True
    x_axis: str
    y_axis: str = "residual_component_1"
    z_axis: str | None = None
    reducer: str
    points: list[RiskMapPoint]
    metrics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class ScanRiskProjectionResponse(BaseModel):
    """Current scan score and score-aligned projection."""

    scan_id: str
    model_version: str
    mode: RiskMapMode
    projection_type: str = "score_aligned_pls_residual_map_v1"
    embedding_risk_score: float
    final_risk_score: float
    risk_points: int
    risk_level: Literal["low", "medium", "high"]
    x2d: float
    y2d: float
    x3d: float
    y3d: float
    z3d: float
    prototype_cosines: dict[str, float] = Field(default_factory=dict)
    top_neighbors: list[RiskMapNeighbor] = Field(default_factory=list)
    score_breakdown: dict[str, Any] = Field(default_factory=dict)
    projection_metadata: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
