"""Tests for backend-owned external fraud lookup clients."""

from __future__ import annotations

import httpx
import pytest

from app.schemas.external_lookup import ExternalLookupRequest, ExternalLookupResponse
from app.services.external_lookup import (
    PoliceLookupError,
    external_lookup_service,
    get_thecheat_cdp_url,
    parse_thecheat_result,
)


def test_police_lookup_posts_phone_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    """Phone lookup should use the police P type and parse the reported count."""

    captured: dict[str, object] = {}

    def mock_post(self: httpx.Client, url: str, *args, **kwargs) -> httpx.Response:
        captured["url"] = url
        captured["data"] = kwargs["data"]
        request = httpx.Request("POST", url)
        return httpx.Response(
            200,
            request=request,
            json={"result": True, "value": [{"result": "OK", "count": "0"}], "message": ""},
        )

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    result = external_lookup_service.lookup(
        ExternalLookupRequest(provider="police", kind="phone", keyword="01041120302")
    )

    assert captured["url"] == "https://www.police.go.kr/user/cyber/fraud.do"
    assert captured["data"] == {"key": "P", "no": "01041120302", "ftype": "P"}
    assert result.status == "completed"
    assert result.report_count == 0
    assert result.risk_found is False


def test_police_lookup_posts_account_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    """Account lookup should use the police A type and flag counts above the threshold."""

    def mock_post(self: httpx.Client, url: str, *args, **kwargs) -> httpx.Response:
        request = httpx.Request("POST", url)
        return httpx.Response(
            200,
            request=request,
            json={"result": True, "value": [{"result": "OK", "count": "4"}], "message": ""},
        )

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    result = external_lookup_service.lookup(
        ExternalLookupRequest(provider="police", kind="account", keyword="3020264877711")
    )

    assert result.status == "completed"
    assert result.report_count == 4
    assert result.risk_found is True
    assert "3건 이상" in result.message


def test_police_lookup_rejects_bad_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """Malformed police responses should become a stable service error."""

    def mock_post(self: httpx.Client, url: str, *args, **kwargs) -> httpx.Response:
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json={"result": False, "value": []})

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    with pytest.raises(PoliceLookupError):
        external_lookup_service._lookup_police_http(
            ExternalLookupRequest(provider="police", kind="phone", keyword="01041120302")
        )


def test_police_lookup_falls_back_to_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    """If direct HTTP is blocked, the service should try browser automation."""

    def mock_http(_payload: ExternalLookupRequest):
        raise PoliceLookupError("connection reset")

    def mock_browser(payload: ExternalLookupRequest):
        return external_lookup_service._build_police_response(payload, count=0)

    monkeypatch.setattr(external_lookup_service, "_lookup_police_http", mock_http)
    monkeypatch.setattr(external_lookup_service, "_lookup_police_browser", mock_browser)

    result = external_lookup_service.lookup(
        ExternalLookupRequest(provider="police", kind="account", keyword="3020264877711")
    )

    assert result.status == "completed"
    assert result.report_count == 0
    assert result.risk_found is False


def test_thecheat_login_required_detection() -> None:
    """TheCheat redirects unauthenticated searches to the OTP login page."""

    result = parse_thecheat_result(
        keyword="01041120302",
        kind="phone",
        final_url="https://thecheat.co.kr/rb/?mod=ssl_login_otp",
        page_text="더치트 앱에서 인증코드를 확인해 주세요.",
    )

    assert result.status == "login_required"
    assert result.risk_found is None
    assert "로그인" in result.message


def test_thecheat_uses_configured_cdp_browser_endpoint() -> None:
    """A live Docker browser endpoint is the only supported TheCheat session source."""

    assert get_thecheat_cdp_url("http://lookup-browser:9223") == "http://lookup-browser:9223"


def test_thecheat_requires_cdp_browser_endpoint() -> None:
    """TheCheat lookup should fail clearly if no Docker browser endpoint is configured."""

    with pytest.raises(ValueError, match="THECHEAT_CDP_URL"):
        get_thecheat_cdp_url("")


def test_thecheat_lookup_uses_cdp_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """TheCheat lookup should reuse the Docker browser instead of launching a new browser."""

    payload = ExternalLookupRequest(provider="thecheat", kind="account", keyword="3020264877711")
    captured: dict[str, object] = {}

    class StubSettings:
        thecheat_cdp_url = "http://lookup-browser:9223"
        external_lookup_timeout_ms = 15000

    def mock_lookup_cdp(lookup_payload: ExternalLookupRequest, cdp_url: str) -> ExternalLookupResponse:
        captured["payload"] = lookup_payload
        captured["cdp_url"] = cdp_url
        return ExternalLookupResponse(
            provider="thecheat",
            kind=lookup_payload.kind,
            keyword=lookup_payload.keyword,
            status="completed",
            message="cdp lookup completed",
            source_url="https://thecheat.co.kr/rb/?mod=_search_result",
        )

    def fail_if_local_playwright_is_used():
        raise AssertionError("expected CDP lookup path")

    monkeypatch.setattr("app.services.external_lookup.get_settings", lambda: StubSettings())
    monkeypatch.setattr(external_lookup_service, "_lookup_thecheat_cdp", mock_lookup_cdp, raising=False)
    monkeypatch.setattr("app.services.external_lookup.sync_playwright", fail_if_local_playwright_is_used)

    result = external_lookup_service._lookup_thecheat(payload)

    assert result.status == "completed"
    assert captured["payload"] == payload
    assert captured["cdp_url"] == "http://lookup-browser:9223"
