import logging
import hashlib
import random
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from playwright.sync_api import Page, sync_playwright

from utils.file_utils import save_json, write_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

MARKETPLACE_PAGES = [
    {
        "platform": "joonggonara",
        "search_url": "https://web.joongna.com/search/%ED%8B%B0%EC%BC%93%20%EC%96%91%EB%8F%84",
        "base_url": "https://web.joongna.com",
        "allowed_tokens": ["/product/", "/products/", "/article/", "/articles/"],
    },
    {
        "platform": "bungaejangter",
        "search_url": "https://m.bunjang.co.kr/search/products?q=%ED%8B%B0%EC%BC%93%EC%96%91%EB%8F%84",
        "base_url": "https://m.bunjang.co.kr",
        "allowed_tokens": ["/products/"],
    },
]

BLOCKED_TOKENS = [
    "/search",
    "/favorite",
    "/login",
    "/join",
    "/category",
    "/event",
    "/help",
    "/notice",
]

INVALID_TITLE_LINES = {
    "판매자센터",
    "로그인",
    "회원가입",
    "카테고리",
    "번개장터",
    "중고나라",
    "찜",
    "검색",
}


def _select_first(soup: BeautifulSoup, selectors: list[str]) -> Any:
    for selector in selectors:
        element = soup.select_one(selector)
        if element and element.get_text(strip=True):
            return element
    return None


def _extract_rendered_text(page: Page) -> str:
    try:
        return page.locator("body").inner_text(timeout=7000)
    except Exception:
        return ""


def _extract_price_from_text(text: str) -> str:
    if not text:
        return ""

    match = re.search(r"(\d{1,3}(?:,\d{3})+|\d+)\s*원", text)
    return match.group(0) if match else ""


def _extract_title_from_rendered_text(rendered_text: str) -> str:
    if not rendered_text:
        return ""

    priority_keywords = [
        "티켓",
        "콘서트",
        "양도",
        "예매",
        "좌석",
        "공연",
        "팬미팅",
        "뮤지컬",
        "페스티벌",
    ]

    lines = [line.strip() for line in rendered_text.splitlines() if line.strip()]

    for line in lines:
        if line in INVALID_TITLE_LINES:
            continue
        if len(line) < 2:
            continue
        if any(keyword in line for keyword in priority_keywords):
            return line

    for line in lines:
        if line in INVALID_TITLE_LINES:
            continue
        if len(line) >= 4:
            return line

    return ""


def parse_marketplace_html(
    html: str,
    platform: str,
    page_url: str,
    default_url: str,
    rendered_text: str = "",
) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")

    if platform == "joonggonara":
        title_selectors = [".detail-info .title", ".post-title", "h1", "h2", ".title"]
        content_selectors = [".detail-info .content", ".article-body", ".description", ".detail-text", ".content"]
        price_selectors = [".product-price", ".price", ".detail-info .cost", ".cost"]
        seller_selectors = [".seller-info", ".seller", ".author", ".user-name", ".nickname"]
    elif platform == "bungaejangter":
        title_selectors = [".product-title", "h1", "h2", ".title"]
        content_selectors = [".product-description", ".description", ".detail-view", ".content"]
        price_selectors = [".price", ".amount", ".product-price"]
        seller_selectors = [".seller-name", ".user-name", ".store-name", ".author"]
    else:
        title_selectors = ["h1", "h2", ".title"]
        content_selectors = [".content", ".description", ".article-body"]
        price_selectors = [".price", ".amount"]
        seller_selectors = [".seller", ".author"]

    title_el = _select_first(soup, title_selectors)
    content_el = _select_first(soup, content_selectors)
    price_el = _select_first(soup, price_selectors)
    seller_el = _select_first(soup, seller_selectors)

    title = title_el.get_text(strip=True) if title_el else ""
    content = content_el.get_text(" ", strip=True) if content_el else ""
    price = price_el.get_text(strip=True) if price_el else ""
    seller_id = seller_el.get_text(strip=True) if seller_el else ""

    if not title or title in INVALID_TITLE_LINES:
        title = _extract_title_from_rendered_text(rendered_text)

    if not content:
        content = rendered_text

    if not price:
        price = _extract_price_from_text(rendered_text)

    return {
        "platform": platform,
        "url": page_url or default_url,
        "title": title,
        "content": content,
        "price": price,
        "seller_id": seller_id,
        "raw_html": html,
        "rendered_text": rendered_text,
        "crawled_at": datetime.utcnow().isoformat() + "Z",
    }


def _collect_visible_detail_links(
    page: Page,
    page_info: dict[str, Any],
    links: list[str],
    seen_links: set[str],
    max_links: int,
) -> None:
    base_url = page_info["base_url"]
    allowed_tokens = page_info["allowed_tokens"]

    anchors = page.query_selector_all("a[href]")

    for anchor in anchors:
        try:
            href = anchor.get_attribute("href")
            if not href:
                continue

            href = href.strip()

            if href.startswith("javascript:") or href.startswith("#"):
                continue

            absolute_url = urljoin(base_url, href)

            if any(token in absolute_url for token in BLOCKED_TOKENS):
                continue

            if not any(token in absolute_url for token in allowed_tokens):
                continue

            if absolute_url not in seen_links:
                seen_links.add(absolute_url)
                links.append(absolute_url)

            if len(links) >= max_links:
                break

        except Exception:
            continue


def _collect_detail_links(
    page: Page,
    page_info: dict[str, Any],
    max_links: int = 5,
    scroll_rounds: int = 0,
) -> list[str]:
    links: list[str] = []
    seen_links: set[str] = set()

    _collect_visible_detail_links(page, page_info, links, seen_links, max_links)

    last_scroll_height = 0
    stagnant_rounds = 0

    for scroll_idx in range(scroll_rounds):
        if len(links) >= max_links:
            break

        try:
            scroll_height = page.evaluate("() => document.body.scrollHeight")
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(random.randint(900, 1600))

            _collect_visible_detail_links(page, page_info, links, seen_links, max_links)

            new_scroll_height = page.evaluate("() => document.body.scrollHeight")
            if new_scroll_height == last_scroll_height or new_scroll_height == scroll_height:
                stagnant_rounds += 1
            else:
                stagnant_rounds = 0

            last_scroll_height = new_scroll_height

            logging.info(
                "Scroll %d/%d collected %d/%d links for %s",
                scroll_idx + 1,
                scroll_rounds,
                len(links),
                max_links,
                page_info["platform"],
            )

            if stagnant_rounds >= 3:
                logging.info("Stopping scroll collection for %s: no new page growth", page_info["platform"])
                break

        except Exception as exc:
            logging.warning("Failed while scrolling search page for %s: %s", page_info["platform"], exc)
            break

    return links[:max_links]


def _goto_with_retries(
    page: Page,
    url: str,
    retries: int = 2,
    timeout_ms: int = 30000,
) -> bool:
    for attempt in range(1, retries + 2):
        try:
            page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            return True
        except Exception as exc:
            if attempt > retries:
                logging.error("Failed to load %s after %d attempts: %s", url, attempt, exc)
                return False

            sleep_seconds = min(2 * attempt, 6)
            logging.warning(
                "Retrying %s after load failure (%d/%d): %s",
                url,
                attempt,
                retries + 1,
                exc,
            )
            time.sleep(sleep_seconds)

    return False


def crawl_marketplace_pages(
    raw_dir: Path,
    max_links_per_platform: int = 5,
    retries: int = 2,
    scroll_rounds: int = 0,
) -> list[dict[str, Any]]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    posts: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        page = browser.new_page(
            viewport={"width": 1440, "height": 1200},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        for page_info in MARKETPLACE_PAGES:
            platform = page_info["platform"]
            logging.info("Loading search page for %s", platform)

            if not _goto_with_retries(page, page_info["search_url"], retries=retries):
                continue

            time.sleep(random.uniform(1.0, 2.0))

            detail_links = _collect_detail_links(
                page,
                page_info,
                max_links=max_links_per_platform,
                scroll_rounds=scroll_rounds,
            )
            logging.info("Collected %d links for %s", len(detail_links), platform)

            for idx, detail_url in enumerate(detail_links, start=1):
                try:
                    logging.info("Visiting detail page %s", detail_url)
                    if not _goto_with_retries(page, detail_url, retries=retries):
                        continue

                    time.sleep(random.uniform(1.0, 2.0))

                    html = page.content()
                    rendered_text = _extract_rendered_text(page)

                    parsed = parse_marketplace_html(
                        html=html,
                        platform=platform,
                        page_url=detail_url,
                        default_url=page_info["base_url"],
                        rendered_text=rendered_text,
                    )

                    artifact_key = _build_artifact_key(platform, detail_url, idx)
                    raw_html_path = raw_dir / f"raw_{artifact_key}.html"
                    rendered_text_path = raw_dir / f"rendered_text_{artifact_key}.txt"
                    parsed_json_path = raw_dir / f"parsed_{artifact_key}.json"

                    write_text(raw_html_path, html)
                    write_text(rendered_text_path, rendered_text)
                    save_json(parsed_json_path, parsed)

                    posts.append(parsed)

                except Exception as exc:
                    logging.error("Failed to parse detail page %s: %s", detail_url, exc)
                    continue

        browser.close()

    return posts


def _build_artifact_key(platform: str, url: str, idx: int) -> str:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:10]
    return f"{platform}_{idx:04d}_{digest}"
