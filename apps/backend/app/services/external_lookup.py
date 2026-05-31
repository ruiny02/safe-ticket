"""External fraud lookup clients used by the backend API."""

from __future__ import annotations

import threading

import httpx
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.core.config import get_settings
from app.schemas.external_lookup import ExternalLookupRequest, ExternalLookupResponse


POLICE_FRAUD_URL = "https://www.police.go.kr/user/cyber/fraud.do"
POLICE_PAGE_URL = "https://www.police.go.kr/www/security/cyber/cyber04.jsp#none"
THECHEAT_SEARCH_URL = "https://thecheat.co.kr/rb/?mod=_search"


class ExternalLookupError(RuntimeError):
    """Base error for lookup failures that should not crash the API."""


class PoliceLookupError(ExternalLookupError):
    """Raised when the police lookup endpoint returns an unusable response."""


class TheCheatLookupError(ExternalLookupError):
    """Raised when TheCheat browser automation cannot complete."""


def parse_thecheat_result(
    *,
    keyword: str,
    kind: str,
    final_url: str,
    page_text: str,
) -> ExternalLookupResponse:
    """Normalize a TheCheat result page or login redirect."""
    normalized_text = " ".join(page_text.split())
    if "mod=ssl_login_otp" in final_url or "인증코드" in normalized_text or "로그인" in normalized_text[:300]:
        return ExternalLookupResponse(
            provider="thecheat",
            kind=kind,
            keyword=keyword,
            status="login_required",
            message="더치트 조회는 로그인 또는 앱 OTP 인증이 필요합니다.",
            source_url=final_url,
            risk_found=None,
            result_text=normalized_text[:1000] or None,
        )

    return ExternalLookupResponse(
        provider="thecheat",
        kind=kind,
        keyword=keyword,
        status="completed",
        message="더치트 조회 결과 페이지에 도달했습니다.",
        source_url=final_url,
        risk_found=None,
        result_text=normalized_text[:2000] or None,
    )


def get_thecheat_cdp_url(cdp_url: str) -> str:
    """Return the configured Docker browser endpoint or fail with an actionable error."""
    if cdp_url:
        return cdp_url
    raise ValueError("THECHEAT_CDP_URL must point to the lookup-browser CDP endpoint.")


class ExternalLookupService:
    """Dispatch lookup requests to the requested external provider."""

    def __init__(self) -> None:
        """Create provider-specific coordination primitives."""
        self._thecheat_lock = threading.Lock()

    def lookup(self, payload: ExternalLookupRequest) -> ExternalLookupResponse:
        """Run the provider-specific lookup."""
        if payload.provider == "police":
            return self._lookup_police(payload)
        if payload.provider == "thecheat":
            return self._lookup_thecheat(payload)
        raise ExternalLookupError(f"Unsupported lookup provider: {payload.provider}")

    def _lookup_police(self, payload: ExternalLookupRequest) -> ExternalLookupResponse:
        """Lookup police data, falling back to browser automation if direct HTTP is blocked."""
        try:
            return self._lookup_police_http(payload)
        except PoliceLookupError:
            return self._lookup_police_browser(payload)

    def _lookup_police_http(self, payload: ExternalLookupRequest) -> ExternalLookupResponse:
        """Lookup a phone or account number using the police cyber fraud endpoint."""
        ftype = "P" if payload.kind == "phone" else "A"
        data = {"key": "P", "no": payload.keyword, "ftype": ftype}

        try:
            with httpx.Client(timeout=10.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
                response = client.post(POLICE_FRAUD_URL, data=data)
                response.raise_for_status()
                body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise PoliceLookupError(f"경찰청 조회 요청에 실패했습니다: {exc}") from exc

        try:
            count = int(body["value"][0]["count"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise PoliceLookupError("경찰청 조회 응답 형식이 예상과 다릅니다.") from exc

        return self._build_police_response(payload, count=count)

    def _lookup_police_browser(self, payload: ExternalLookupRequest) -> ExternalLookupResponse:
        """Lookup police data through the public page when direct HTTP is reset."""
        settings = get_settings()
        selector = "#phone" if payload.kind == "phone" else "#account"
        fraud_type = "1" if payload.kind == "phone" else "2"

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=["--no-sandbox"],
                )
                context = browser.new_context()
                page = context.new_page()
                page.goto(POLICE_PAGE_URL, wait_until="domcontentloaded", timeout=settings.external_lookup_timeout_ms)
                page.wait_for_selector(selector, state="attached", timeout=settings.external_lookup_timeout_ms)
                response_promise = page.expect_response(
                    lambda response: "/user/cyber/fraud.do" in response.url,
                    timeout=settings.external_lookup_timeout_ms,
                )
                with response_promise as response_info:
                    page.evaluate(
                        """({ selector, keyword, fraudType }) => {
                            const input = document.querySelector(selector);
                            input.value = keyword;
                            input.dispatchEvent(new Event("input", { bubbles: true }));
                            input.dispatchEvent(new Event("change", { bubbles: true }));
                            fraudSearch(fraudType);
                        }""",
                        {
                            "selector": selector,
                            "keyword": payload.keyword,
                            "fraudType": fraud_type,
                        },
                    )
                response = response_info.value
                body = response.json()
                context.close()
                browser.close()
        except (PlaywrightError, PlaywrightTimeoutError, ValueError) as exc:
            raise PoliceLookupError(f"경찰청 브라우저 조회에 실패했습니다: {exc}") from exc

        try:
            count = int(body["value"][0]["count"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise PoliceLookupError("경찰청 브라우저 조회 응답 형식이 예상과 다릅니다.") from exc

        return self._build_police_response(payload, count=count)

    def _build_police_response(self, payload: ExternalLookupRequest, *, count: int) -> ExternalLookupResponse:
        """Build the normalized police lookup response from a reported count."""
        risk_found = count >= 3
        if risk_found:
            message = f"최근 3개월 내 사이버범죄 신고시스템에 사기 피해 신고가 3건 이상({count}건) 접수되었습니다."
        else:
            message = "최근 3개월 내 사기 피해 신고가 3건 이상 접수된 이력은 확인되지 않습니다."

        return ExternalLookupResponse(
            provider="police",
            kind=payload.kind,
            keyword=payload.keyword,
            status="completed",
            message=message,
            source_url=POLICE_PAGE_URL,
            report_count=count,
            risk_found=risk_found,
        )

    def _lookup_thecheat(self, payload: ExternalLookupRequest) -> ExternalLookupResponse:
        """Lookup a keyword through TheCheat using Playwright browser automation."""
        settings = get_settings()
        try:
            cdp_url = get_thecheat_cdp_url(settings.thecheat_cdp_url)
        except ValueError as exc:
            raise TheCheatLookupError(str(exc)) from exc

        with self._thecheat_lock:
            return self._lookup_thecheat_cdp(payload, cdp_url)

    def _lookup_thecheat_cdp(self, payload: ExternalLookupRequest, cdp_url: str) -> ExternalLookupResponse:
        """Lookup TheCheat using the shared Docker browser session."""
        settings = get_settings()

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp(
                    cdp_url,
                    timeout=settings.external_lookup_timeout_ms,
                )
                try:
                    context = browser.contexts[0] if browser.contexts else browser.new_context()
                    page = context.new_page()
                    try:
                        final_url, page_text = self._submit_thecheat_search(page, payload)
                    finally:
                        page.close()
                finally:
                    browser.close()
        except (PlaywrightError, PlaywrightTimeoutError) as exc:
            raise TheCheatLookupError(
                "더치트 Docker 브라우저 조회에 실패했습니다. "
                "http://localhost:6080에서 로그인/OTP 상태를 확인하세요: "
                f"{exc}"
            ) from exc

        return parse_thecheat_result(
            keyword=payload.keyword,
            kind=payload.kind,
            final_url=final_url,
            page_text=page_text,
        )

    def _submit_thecheat_search(self, page, payload: ExternalLookupRequest) -> tuple[str, str]:
        """Submit a TheCheat keyword search in the given logged-in page context."""
        settings = get_settings()
        page.goto(
            THECHEAT_SEARCH_URL,
            wait_until="domcontentloaded",
            timeout=settings.external_lookup_timeout_ms,
        )
        page.wait_for_selector("input[name='keyword']", timeout=settings.external_lookup_timeout_ms)
        page.evaluate(
            """(keyword) => {
                const input = document.querySelector("input[name='keyword']");
                input.value = keyword;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                form_submit("search", "./?mod=_search_result");
            }""",
            payload.keyword,
        )
        page.wait_for_load_state("domcontentloaded", timeout=settings.external_lookup_timeout_ms)
        page.wait_for_timeout(1000)
        page_text = page.locator("body").inner_text(timeout=settings.external_lookup_timeout_ms)
        return page.url, page_text


external_lookup_service = ExternalLookupService()
