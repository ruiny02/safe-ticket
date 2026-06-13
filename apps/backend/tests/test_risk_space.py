"""Tests for supervised risk-aware embedding space."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_safe_ticket.db")

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.db.base import Base
from app.db.models import Case, CaseChunk, PipelineExchange, Scan
from app.db.session import SessionLocal, engine
from app.main import app
from app.core.config import get_settings
from app.schemas.scan import PipelineOutboundPayload
from app.services.risk_space.data_loader import load_case_embedding_dataset
from app.services.risk_space.project_scan import project_embedding
from app.services.risk_space.train import train_risk_space_model


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_database(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("RISK_SPACE_ARTIFACT_DIR", str(tmp_path / "risk_space"))
    get_settings.cache_clear()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    get_settings.cache_clear()


def seed_risk_cases() -> None:
    rows = [
        ("safe_1", "low", [1.0, 0.0, 0.0, 0.0]),
        ("safe_2", "low", [0.95, 0.05, 0.0, 0.0]),
        ("safe_3", "low", [0.9, 0.1, 0.0, 0.0]),
        ("border_1", "medium", [0.5, 0.5, 0.0, 0.0]),
        ("border_2", "medium", [0.45, 0.55, 0.0, 0.0]),
        ("fraud_1", "high", [0.0, 1.0, 0.0, 0.0]),
        ("fraud_2", "high", [0.05, 0.95, 0.0, 0.0]),
        ("fraud_3", "high", [0.1, 0.9, 0.0, 0.0]),
    ]
    with SessionLocal() as db:
        for case_id, risk_level, embedding in rows:
            db.add(
                Case(
                    case_id=case_id,
                    source_type="test",
                    source_url=f"https://example.com/{case_id}",
                    title=case_id,
                    body=f"{case_id} body",
                    label=risk_level,
                    risk_level=risk_level,
                    risk_score={"low": 0.1, "medium": 0.5, "high": 0.9}[risk_level],
                    summary=f"{case_id} summary",
                    platform_hint="joonggonara",
                    risk_flags_json=[],
                    chunks=[
                        CaseChunk(
                            chunk_order=0,
                            chunk_text=f"{case_id} chunk",
                            embedding=embedding,
                        )
                    ],
                )
            )
        db.commit()


def seed_risk_cases_for_umap() -> None:
    """Add enough varied cases for the residual UMAP reducer path."""
    seed_risk_cases()
    rows = [
        ("safe_4", "low", [0.88, 0.12, 0.05, 0.0]),
        ("safe_5", "low", [0.86, 0.14, 0.0, 0.05]),
        ("border_3", "medium", [0.52, 0.48, 0.1, 0.0]),
        ("fraud_4", "high", [0.02, 0.98, 0.0, 0.1]),
    ]
    with SessionLocal() as db:
        for case_id, risk_level, embedding in rows:
            db.add(
                Case(
                    case_id=case_id,
                    source_type="test",
                    source_url=f"https://example.com/{case_id}",
                    title=case_id,
                    body=f"{case_id} body",
                    label=risk_level,
                    risk_level=risk_level,
                    risk_score={"low": 0.1, "medium": 0.5, "high": 0.9}[risk_level],
                    summary=f"{case_id} summary",
                    platform_hint="joonggonara",
                    risk_flags_json=[],
                    chunks=[
                        CaseChunk(
                            chunk_order=0,
                            chunk_text=f"{case_id} chunk",
                            embedding=embedding,
                        )
                    ],
                )
            )
        db.commit()


def seed_pls7_cases_for_map() -> None:
    """Add enough eight-dimensional cases to exercise PLS7 scoring and maps."""
    rows = [
        ("safe_a", "low", 0.03, [1.00, 0.05, 0.02, 0.01, 0.00, 0.03, 0.02, 0.01]),
        ("safe_b", "low", 0.07, [0.95, 0.10, 0.04, 0.03, 0.02, 0.01, 0.02, 0.00]),
        ("safe_c", "low", 0.11, [0.90, 0.12, 0.06, 0.04, 0.03, 0.02, 0.01, 0.02]),
        ("safe_d", "low", 0.13, [0.86, 0.15, 0.08, 0.04, 0.04, 0.03, 0.02, 0.01]),
        ("border_a", "medium", 0.19, [0.68, 0.30, 0.16, 0.10, 0.05, 0.06, 0.04, 0.02]),
        ("border_b", "medium", 0.24, [0.60, 0.38, 0.19, 0.12, 0.07, 0.05, 0.05, 0.03]),
        ("border_c", "medium", 0.29, [0.54, 0.45, 0.22, 0.14, 0.09, 0.08, 0.05, 0.04]),
        ("border_d", "medium", 0.31, [0.50, 0.50, 0.25, 0.16, 0.10, 0.07, 0.06, 0.05]),
        ("fraud_a", "high", 0.58, [0.28, 0.78, 0.34, 0.24, 0.12, 0.10, 0.08, 0.06]),
        ("fraud_b", "high", 0.70, [0.18, 0.88, 0.42, 0.30, 0.16, 0.12, 0.09, 0.08]),
        ("fraud_c", "high", 0.82, [0.10, 0.96, 0.48, 0.35, 0.20, 0.14, 0.12, 0.09]),
        ("fraud_d", "high", 0.91, [0.05, 1.00, 0.52, 0.40, 0.24, 0.18, 0.14, 0.10]),
    ]
    with SessionLocal() as db:
        for case_id, risk_level, risk_score, embedding in rows:
            db.add(
                Case(
                    case_id=case_id,
                    source_type="test",
                    source_url=f"https://example.com/{case_id}",
                    title=case_id,
                    body=f"{case_id} body",
                    label=risk_level,
                    risk_level=risk_level,
                    risk_score=risk_score,
                    summary=f"{case_id} summary",
                    platform_hint="joonggonara",
                    risk_flags_json=[],
                    chunks=[
                        CaseChunk(
                            chunk_order=0,
                            chunk_text=f"{case_id} chunk",
                            embedding=embedding,
                        )
                    ],
                )
            )
        db.commit()


def test_data_loader_mean_pools_normalizes_and_maps_labels() -> None:
    seed_risk_cases()

    dataset = load_case_embedding_dataset()

    assert dataset.embedding_dim == 4
    assert dataset.sample_counts == {"safe": 3, "borderline": 2, "fraud": 3}
    assert np.allclose(np.linalg.norm(dataset.x_raw, axis=1), 1.0)
    assert set(dataset.y.tolist()) == {0.1, 0.5, 0.9}


def test_data_loader_uses_continuous_case_risk_score_targets() -> None:
    with SessionLocal() as db:
        for case_id, risk_level, risk_score, embedding in [
            ("continuous_safe", "low", 0.08, [1.0, 0.0, 0.0, 0.0]),
            ("continuous_medium", "medium", 0.26, [0.5, 0.5, 0.0, 0.0]),
            ("continuous_fraud", "high", 0.86, [0.0, 1.0, 0.0, 0.0]),
        ]:
            db.add(
                Case(
                    case_id=case_id,
                    source_type="test",
                    source_url=f"https://example.com/{case_id}",
                    title=case_id,
                    body=f"{case_id} body",
                    label=risk_level,
                    risk_level=risk_level,
                    risk_score=risk_score,
                    summary=f"{case_id} summary",
                    platform_hint="joonggonara",
                    risk_flags_json=[],
                    chunks=[CaseChunk(chunk_order=0, chunk_text=f"{case_id} chunk", embedding=embedding)],
                )
            )
        db.commit()

    dataset = load_case_embedding_dataset()

    targets_by_id = dict(zip(dataset.case_ids, dataset.y.tolist(), strict=True))
    assert targets_by_id["continuous_safe"] == pytest.approx(0.08)
    assert targets_by_id["continuous_medium"] == pytest.approx(0.26)
    assert targets_by_id["continuous_fraud"] == pytest.approx(0.86)
    assert dataset.labels_str == ["fraud", "borderline", "safe"]


def test_train_risk_space_model_scores_synthetic_fraud_above_safe() -> None:
    seed_risk_cases()
    dataset = load_case_embedding_dataset()

    artifact, report = train_risk_space_model(dataset)
    safe_score = project_embedding(
        artifact=artifact,
        point_id="safe_query",
        label="safe",
        embedding=np.asarray([1.0, 0.0, 0.0, 0.0]),
    )
    fraud_score = project_embedding(
        artifact=artifact,
        point_id="fraud_query",
        label="fraud",
        embedding=np.asarray([0.0, 1.0, 0.0, 0.0]),
    )

    assert safe_score.embedding_risk_score < fraud_score.embedding_risk_score
    assert safe_score.coordinates.x2d < fraud_score.coordinates.x2d
    assert report["selected_candidate"]["pls_components"] >= 1
    assert report["selected_candidate"]["scoring_variant"] != "full_pls_16d_cosine"
    assert artifact.score_weights == {"pls": 0.7, "prototype": 0.15, "neighbor": 0.15}
    assert artifact.metrics["selected_active_model_reason"]
    assert report["metrics"]["class_mean_scores"]


def test_score_uses_pls1_primary_and_pls7_cosine_stabilizers() -> None:
    seed_pls7_cases_for_map()
    dataset = load_case_embedding_dataset()
    artifact, _report = train_risk_space_model(dataset)

    scored = project_embedding(
        artifact=artifact,
        point_id="borderline_query",
        label="borderline",
        embedding=np.asarray([0.50, 0.50, 0.25, 0.16, 0.10, 0.07, 0.06, 0.05]),
    )

    risk_score = scored.risk_score
    assert risk_score is not None
    assert artifact.scoring_variant == "weighted_pls7_cosine"
    assert artifact.component_weights
    assert risk_score.confidence["scoring_strategy"] == "pls1_primary_pls7_cosine_v1"
    assert risk_score.confidence["neighbor_similarity_type"] == "weighted_low_dim_cosine"
    assert risk_score.confidence["prototype_similarity_type"] == "weighted_low_dim_cosine"
    expected = (
        artifact.score_weights["pls"] * risk_score.calibrated_pls_score
        + artifact.score_weights["prototype"] * risk_score.prototype_score
        + artifact.score_weights["neighbor"] * risk_score.neighbor_score
    )
    assert risk_score.embedding_risk_score == pytest.approx(expected)
    assert artifact.score_weights["pls"] == pytest.approx(0.7)
    assert artifact.score_weights["prototype"] == pytest.approx(0.15)
    assert artifact.score_weights["neighbor"] == pytest.approx(0.15)


def test_runtime_training_can_skip_full_candidate_search() -> None:
    seed_pls7_cases_for_map()
    dataset = load_case_embedding_dataset()

    artifact, report = train_risk_space_model(dataset, candidate_mode="active")

    assert artifact.scoring_variant == "weighted_pls7_cosine"
    assert artifact.score_weights == {"pls": 0.7, "prototype": 0.15, "neighbor": 0.15}
    assert report["selected_candidate"]["scoring_variant"] == "weighted_pls7_cosine"
    assert report["diagnostic_baselines"] == {}
    assert len(report["candidate_results"]) == 1


def test_training_report_flags_leakage_uncertainty_and_duplicate_groups() -> None:
    seed_risk_cases()
    with SessionLocal() as db:
        duplicate = Case(
            case_id="safe_duplicate_url",
            source_type="test",
            source_url="https://example.com/safe_1",
            title="safe duplicate",
            body="safe duplicate body",
            label="low",
            risk_level="low",
            risk_score=0.1,
            summary="duplicate url",
            platform_hint="joonggonara",
            risk_flags_json=[],
            chunks=[
                CaseChunk(
                    chunk_order=0,
                    chunk_text="safe duplicate chunk",
                    embedding=[0.98, 0.02, 0.0, 0.0],
                )
            ],
        )
        db.add(duplicate)
        db.commit()

    dataset = load_case_embedding_dataset()
    artifact, report = train_risk_space_model(dataset)

    assert any("embedding_source_verification_unavailable" in warning for warning in artifact.warnings)
    assert any("duplicate_source_url_groups" in warning for warning in artifact.warnings)
    assert report["diagnostics"]["duplicate_group_warnings"]
    assert report["diagnostics"]["leakage_warnings"]
    assert "full_pls_16d_cosine" in report["diagnostic_baselines"]


def test_risk_map_endpoint_returns_score_aligned_points(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seed_risk_cases()
    monkeypatch.setenv("RISK_SPACE_ARTIFACT_DIR", str(tmp_path / "risk_space_endpoint"))

    response = client.get("/api/v1/cases/risk-map?dim=3&mode=embedding&projection=score_aligned")

    assert response.status_code == 200
    body = response.json()
    assert body["projection_type"] == "score_aligned_pls_residual_map_v1"
    assert body["score_aligned"] is True
    assert body["x_axis"] == "embedding_risk_score"
    assert body["z_axis"] == "residual_component_2"
    assert len(body["points"]) == 8
    assert all(8 <= point["x"] <= 92 for point in body["points"])


def test_risk_map_endpoint_defaults_to_pls7_umap_projection(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seed_pls7_cases_for_map()
    monkeypatch.setenv("RISK_SPACE_ARTIFACT_DIR", str(tmp_path / "risk_space_pls7_map"))

    response = client.get("/api/v1/cases/risk-map?dim=3&mode=embedding&reducer=umap")

    assert response.status_code == 200
    body = response.json()
    assert body["projection_type"] == "pls1_semantic_residual_umap_v1"
    assert body["score_aligned"] is False
    assert body["x_axis"] == "calibrated_pls1_risk_axis"
    assert body["y_axis"] == "semantic_residual_umap_component_1"
    assert body["z_axis"] == "semantic_residual_umap_component_2"
    assert body["metrics"]["pls_components"] == 7
    assert len(body["metrics"]["component_weights"]) == 7
    assert body["metrics"]["risk_axis_source"] == "calibrated_pls_component_1"
    assert body["metrics"]["residual_source"] == "raw_embedding_minus_pls1_direction"
    assert body["metrics"]["note"] == "X is calibrated PLS1 risk; Y/Z are unsupervised UMAP of semantic residuals."
    assert len(body["points"]) == 12
    assert all(8 <= point["x"] <= 92 and 8 <= point["y"] <= 92 for point in body["points"])


def test_risk_map_endpoint_supports_umap_residual_reducer(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seed_risk_cases_for_umap()
    monkeypatch.setenv("RISK_SPACE_ARTIFACT_DIR", str(tmp_path / "risk_space_umap_endpoint"))

    response = client.get("/api/v1/cases/risk-map?dim=3&mode=embedding&reducer=umap&projection=score_aligned")

    assert response.status_code == 200
    body = response.json()
    assert body["projection_type"] == "score_aligned_pls_residual_map_v1"
    assert body["score_aligned"] is True
    assert body["reducer"] in {"umap", "pca"}
    assert body["x_axis"] == "embedding_risk_score"
    assert body["y_axis"] == "residual_component_1"
    assert body["z_axis"] == "residual_component_2"
    assert body["metrics"]["residual_visualization"]["source_space"] == "pca_embedding"
    assert body["metrics"]["residual_visualization"]["source_preprocessor"] == "pca"
    assert body["metrics"]["residual_visualization"]["source_dim"] > 1
    assert body["metrics"]["residual_visualization"]["reducer"] == body["reducer"]
    if body["reducer"] == "pca":
        assert any(warning.startswith("residual_umap_fallback:") for warning in body["warnings"])
    assert len(body["points"]) == 12
    assert all(8 <= point["x"] <= 92 and 8 <= point["y"] <= 92 for point in body["points"])


def test_risk_map_endpoint_limits_historical_points(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seed_risk_cases_for_umap()
    monkeypatch.setenv("RISK_SPACE_ARTIFACT_DIR", str(tmp_path / "risk_space_limited_endpoint"))

    response = client.get("/api/v1/cases/risk-map?dim=3&mode=embedding&reducer=umap&limit=5")

    assert response.status_code == 200
    body = response.json()
    assert len(body["points"]) == 5
    assert all(point["label"] != "current" for point in body["points"])


def test_risk_map_endpoint_can_overlay_current_scan(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seed_risk_cases_for_umap()
    monkeypatch.setenv("RISK_SPACE_ARTIFACT_DIR", str(tmp_path / "risk_space_umap_scan_overlay"))
    monkeypatch.setattr(
        "app.services.risk_space.service.embed_query_text",
        lambda _text, *, output_dimensionality: [0.0, 1.0, 0.0, 0.0],
    )
    payload = PipelineOutboundPayload(
        scan_id="scan_current_overlay",
        platform="joonggonara",
        page_url="https://example.com/product/overlay",
        page_title="현재 스캔 게시글",
        price=10000,
        seller={"seller_id": "seller", "nickname": "seller"},
        content_blocks=[{"block_id": "body", "text": "현재 스캔 텍스트"}],
        marketplace_signals=[],
    )
    with SessionLocal() as db:
        db.add(
            Scan(
                scan_id="scan_current_overlay",
                platform="joonggonara",
                page_url="https://example.com/product/overlay",
                page_title="현재 스캔 게시글",
                price=10000,
                status="completed",
                risk_level="high",
                risk_score=0.9,
                risk_points=90,
                risk_score_breakdown_json=[],
                risk_tags=[],
                evidence_items_json=[],
                highlight_targets_json=[],
                similar_cases_json=[],
                recommended_actions_json=[],
                external_lookup_results_json=[],
            )
        )
        db.add(
            PipelineExchange(
                scan_id="scan_current_overlay",
                outbound_payload=payload.model_dump(mode="json"),
                inbound_payload=None,
                pipeline_error=None,
            )
        )
        db.commit()

    response = client.get(
        "/api/v1/cases/risk-map?dim=3&mode=embedding&reducer=umap&limit=5&scan_id=scan_current_overlay"
    )

    assert response.status_code == 200
    body = response.json()
    current_points = [point for point in body["points"] if point["label"] == "current"]
    assert len(current_points) == 1
    assert current_points[0]["case_id"] == "scan_current_overlay"
    assert current_points[0]["title"] == "현재 스캔 게시글"
    assert len(body["points"]) == 6


def test_scan_risk_projection_uses_saved_artifact(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seed_risk_cases()
    monkeypatch.setenv("RISK_SPACE_ARTIFACT_DIR", str(tmp_path / "risk_space_scan"))
    monkeypatch.setattr(
        "app.services.risk_space.service.embed_query_text",
        lambda _text, *, output_dimensionality: [0.0, 1.0, 0.0, 0.0],
    )
    payload = PipelineOutboundPayload(
        scan_id="scan_projection",
        platform="joonggonara",
        page_url="https://example.com/product/1",
        page_title="테스트 게시글",
        price=10000,
        seller={"seller_id": "seller", "nickname": "seller"},
        content_blocks=[{"block_id": "body", "text": "계좌이체 유도"}],
        marketplace_signals=[],
    )
    with SessionLocal() as db:
        db.add(
            Scan(
                scan_id="scan_projection",
                platform="joonggonara",
                page_url="https://example.com/product/1",
                page_title="테스트 게시글",
                price=10000,
                status="completed",
                risk_level="high",
                risk_score=0.9,
                risk_points=90,
                risk_score_breakdown_json=[],
                risk_tags=[],
                evidence_items_json=[],
                highlight_targets_json=[],
                similar_cases_json=[],
                recommended_actions_json=[],
                external_lookup_results_json=[],
            )
        )
        db.add(
            PipelineExchange(
                scan_id="scan_projection",
                outbound_payload=payload.model_dump(mode="json"),
                inbound_payload=None,
                pipeline_error=None,
            )
        )
        db.commit()

    response = client.get("/api/v1/scans/scan_projection/risk-projection?mode=final")

    assert response.status_code == 200
    body = response.json()
    assert body["scan_id"] == "scan_projection"
    assert body["final_risk_score"] == 0.9
    assert body["x3d"] == pytest.approx(8 + 84 * 0.9)
    assert body["top_neighbors"]
