"""API tests for backend external fraud lookups."""

from fastapi.testclient import TestClient

from app.api.routes import external_lookups as external_lookups_route
from app.main import app
from app.schemas.external_lookup import ExternalLookupResponse


client = TestClient(app)


def test_external_lookup_endpoint_returns_service_result(monkeypatch) -> None:
    """The route should expose a stable response for frontend parsed lookup data."""

    def mock_lookup(_payload) -> ExternalLookupResponse:
        return ExternalLookupResponse(
            provider="police",
            kind="account",
            keyword="3020264877711",
            status="completed",
            report_count=0,
            risk_found=False,
            message="최근 3개월 내 3건 이상 접수된 이력은 확인되지 않습니다.",
            source_url="https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
        )

    monkeypatch.setattr(external_lookups_route.external_lookup_service, "lookup", mock_lookup)

    response = client.post(
        "/api/v1/external-lookups",
        json={"provider": "police", "kind": "account", "keyword": "3020264877711"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert response.json()["provider"] == "police"
    assert response.json()["report_count"] == 0
