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


def test_thecheat_completed_result_uses_direct_no_report_message() -> None:
    """Completed TheCheat searches should directly say whether reports were found."""

    result = parse_thecheat_result(
        keyword="3355288620726",
        kind="account",
        final_url="https://thecheat.co.kr/rb/?mod=_search_result",
        page_text="검색 기간 : 최근 3개월 더치트 빅데이터 분석결과 카카오뱅크 계좌로 추정됩니다.",
    )

    assert result.status == "completed"
    assert result.report_count == 0
    assert result.risk_found is False
    assert result.message == "더치트 공개 검색 결과, 최근 3개월 기준 피해사례는 확인되지 않았습니다."


def test_thecheat_ignores_generic_report_registration_copy() -> None:
    """TheCheat navigation/footer text should not be treated as a found report."""

    result = parse_thecheat_result(
        keyword="3020264877711",
        kind="account",
        final_url="https://thecheat.co.kr/rb/?mod=_search_result",
        page_text=(
            "검색 피해등록 홈 헬프센터 검색 기간 : 최근 3개월 "
            "피해사례 등록 후 24시간 동안 피등록자에게 소명 시간이 제공됩니다. "
            "더치트 빅데이터 분석결과 농협 계좌로 추정됩니다. "
            "피해사례 게시물 내용에 대해 더치트는 보증하지 않습니다."
        ),
    )

    assert result.status == "completed"
    assert result.report_count == 0
    assert result.risk_found is False
    assert result.message == "더치트 공개 검색 결과, 최근 3개월 기준 피해사례는 확인되지 않았습니다."


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


def test_thecheat_cleanup_preserves_one_session_page_and_closes_extra_pages() -> None:
    """TheCheat cleanup should keep the user's login page and close every extra tab."""

    class FakePage:
        def __init__(self, url: str) -> None:
            self.url = url
            self.closed = False

        def is_closed(self) -> bool:
            return self.closed

        def close(self) -> None:
            self.closed = True

    class FakeContext:
        def __init__(self) -> None:
            self.pages = [
                FakePage("https://thecheat.co.kr/rb/?mod=ssl_login_otp"),
                FakePage("https://thecheat.co.kr/rb/?mod=_search"),
                FakePage("https://thecheat.co.kr/rb/?mod=_search_result"),
                FakePage("chrome-error://chromewebdata/"),
            ]

    context = FakeContext()
    session_page = context.pages[0]

    external_lookup_service._close_extra_thecheat_pages(context, keep_pages={session_page})

    assert context.pages[0].closed is False
    assert context.pages[1].closed is True
    assert context.pages[2].closed is True
    assert context.pages[3].closed is True


def test_thecheat_session_page_prefers_search_page_over_result_page() -> None:
    """TheCheat session detection should not preserve a stale result page when search is open."""

    class FakePage:
        def __init__(self, url: str) -> None:
            self.url = url

        def is_closed(self) -> bool:
            return False

    class FakeContext:
        def __init__(self) -> None:
            self.pages = [
                FakePage("https://thecheat.co.kr/rb/?mod=_search_result"),
                FakePage("https://thecheat.co.kr/rb/?mod=_search"),
            ]

    context = FakeContext()

    assert external_lookup_service._find_thecheat_session_page(context) is context.pages[1]
