"""Fetch and extract public seller profile information."""

from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from app.core.config import get_settings
from app.schemas.seller import SellerProfileSnapshot


ALLOWED_PROFILE_HOSTS = {
    "web.joongna.com",
    "joongna.com",
    "m.joongna.com",
    "junggonara.co.kr",
    "www.junggonara.co.kr",
}
MAX_TEXT_CHARS = 6000
MAX_PRODUCT_TITLES = 12


class SellerProfileFetchError(RuntimeError):
    """Raised when the backend cannot retrieve useful public profile text."""


class SellerProfileFetcher:
    """Retrieve seller profile pages and convert them into compact facts."""

    def fetch(self, profile_url: str) -> SellerProfileSnapshot:
        """Fetch a seller profile URL and extract public marketplace signals."""
        self._validate_url(profile_url)
        html = self._fetch_html(profile_url)
        text, title_candidates = self._extract_text_and_titles(html)
        if len(text) < 80:
            rendered_html = self._fetch_rendered_html(profile_url)
            rendered_text, rendered_titles = self._extract_text_and_titles(rendered_html)
            if len(rendered_text) > len(text):
                html = rendered_html
                text = rendered_text
                title_candidates = rendered_titles
        if len(text) < 40:
            raise SellerProfileFetchError("seller profile did not contain enough public text")

        return SellerProfileSnapshot(
            profile_url=profile_url,
            seller_name=self._extract_seller_name(text, html),
            response_rate_percent=self._extract_int_after_label(text, r"응답률\s*([0-9]{1,3})\s*%"),
            response_time=self._extract_response_time(text),
            trust_index=self._extract_int_after_label(text, r"신뢰지수\s*([0-9,]+)"),
            safe_payment_count=self._extract_int_after_label(text, r"안심결제\s*([0-9,]+)"),
            review_count=self._extract_int_after_label(text, r"거래후기\s*([0-9,]+)"),
            follower_count=self._extract_int_after_label(text, r"단골\s*([0-9,]+)"),
            total_products=self._extract_int_after_label(text, r"총\s*([0-9,]+)\s*개"),
            recent_product_titles=self._extract_recent_product_titles(text, title_candidates),
            raw_text_excerpt=text[:MAX_TEXT_CHARS],
        )

    def _validate_url(self, profile_url: str) -> None:
        """Restrict server-side fetching to known marketplace profile hosts."""
        parsed = urlparse(profile_url)
        if parsed.scheme not in {"http", "https"}:
            raise SellerProfileFetchError("profile_url must use http or https")
        host = (parsed.hostname or "").lower()
        if host not in ALLOWED_PROFILE_HOSTS:
            raise SellerProfileFetchError(f"profile host is not allowed: {host}")

    def _fetch_html(self, profile_url: str) -> str:
        """Download the public profile page HTML."""
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
            )
        }
        try:
            with httpx.Client(timeout=get_settings().gemini_api_timeout_seconds, follow_redirects=True) as client:
                response = client.get(profile_url, headers=headers)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise SellerProfileFetchError(f"failed to fetch seller profile: {exc}") from exc
        return response.text

    def _fetch_rendered_html(self, profile_url: str) -> str:
        """Render JavaScript-heavy marketplace pages with Playwright when available."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-dev-shm-usage"],
                )
                page = browser.new_page()
                try:
                    timeout_ms = int(get_settings().gemini_api_timeout_seconds * 1000)
                    page.goto(profile_url, wait_until="networkidle", timeout=timeout_ms)
                    page.wait_for_timeout(1200)
                    return page.content()
                finally:
                    page.close()
                    browser.close()
        except Exception as exc:
            raise SellerProfileFetchError(f"failed to render seller profile: {exc}") from exc

    def _extract_text_and_titles(self, html: str) -> tuple[str, list[str]]:
        """Return visible text and title-like attributes from the page."""
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()

        title_candidates = []
        for tag in soup.find_all(["img", "a"]):
            for attr in ("alt", "title", "aria-label"):
                value = tag.get(attr)
                if isinstance(value, str) and value.strip():
                    title_candidates.append(value.strip())

        text = " ".join(soup.get_text(" ").split())
        return text[:MAX_TEXT_CHARS], title_candidates

    def _extract_seller_name(self, text: str, html: str) -> str | None:
        """Infer seller display name from metadata or text near response-rate labels."""
        soup = BeautifulSoup(html, "html.parser")
        for selector in [
            ("meta", {"property": "og:title"}),
            ("meta", {"name": "title"}),
        ]:
            tag = soup.find(*selector)
            content = tag.get("content") if tag else None
            if isinstance(content, str) and content.strip():
                return self._clean_title(content)

        response_index = text.find("응답률")
        if response_index > 0:
            prefix = text[max(0, response_index - 80):response_index].strip()
            tokens = [token for token in re.split(r"\s+", prefix) if token]
            if tokens:
                return self._clean_title(tokens[-1])
        return None

    def _clean_title(self, value: str) -> str:
        """Remove common marketplace suffixes from a display title."""
        cleaned = re.sub(r"\s*[-|]\s*중고나라.*$", "", value).strip()
        return cleaned[:80] or value[:80]

    def _extract_response_time(self, text: str) -> str | None:
        match = re.search(r"보통\s*([^|]{1,30}?응답)", text)
        return match.group(1).strip() if match else None

    def _extract_int_after_label(self, text: str, pattern: str) -> int | None:
        match = re.search(pattern, text)
        if not match:
            return None
        return int(match.group(1).replace(",", ""))

    def _extract_recent_product_titles(self, text: str, candidates: list[str]) -> list[str]:
        """Collect title-like product hints from attributes and visible sale section text."""
        titles: list[str] = []
        for value in candidates:
            self._append_title(titles, value)

        sale_index = text.find("판매상품")
        if sale_index >= 0:
            sale_text = text[sale_index:sale_index + 1800]
            for chunk in re.split(r"\s{2,}| 최신순 | 낮은가격순 | 높은가격순 | 전체 | 판매중 | 예약중 | 판매완료 ", sale_text):
                self._append_title(titles, chunk)

        return titles[:MAX_PRODUCT_TITLES]

    def _append_title(self, titles: list[str], value: str) -> None:
        cleaned = " ".join(value.split()).strip()
        if not (3 <= len(cleaned) <= 80):
            return
        if cleaned in {"판매상품", "전체", "판매중", "예약중", "판매완료", "최신순", "낮은가격순", "높은가격순"}:
            return
        if cleaned not in titles:
            titles.append(cleaned)


seller_profile_fetcher = SellerProfileFetcher()
