import logging
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


def _collect_detail_links(page: Page, page_info: dict[str, Any], max_links: int = 5) -> list[str]:
    base_url = page_info["base_url"]
    allowed_tokens = page_info["allowed_tokens"]

    links: list[str] = []
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

            if absolute_url not in links:
                links.append(absolute_url)

            if len(links) >= max_links:
                break

        except Exception:
            continue

    return links[:max_links]


def crawl_marketplace_pages(raw_dir: Path) -> list[dict[str, Any]]:
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

            try:
                page.goto(page_info["search_url"], wait_until="networkidle", timeout=30000)
                time.sleep(random.uniform(1.0, 2.0))
            except Exception as exc:
                logging.error("Failed to load search page %s: %s", platform, exc)
                continue

            detail_links = _collect_detail_links(page, page_info)
            logging.info("Collected %d links for %s", len(detail_links), platform)

            for idx, detail_url in enumerate(detail_links, start=1):
                try:
                    logging.info("Visiting detail page %s", detail_url)
                    page.goto(detail_url, wait_until="networkidle", timeout=30000)
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

                    raw_html_path = raw_dir / f"raw_{platform}_{idx}.html"
                    rendered_text_path = raw_dir / f"rendered_text_{platform}_{idx}.txt"
                    parsed_json_path = raw_dir / f"parsed_{platform}_{idx}.json"

                    write_text(raw_html_path, html)
                    write_text(rendered_text_path, rendered_text)
                    save_json(parsed_json_path, parsed)

                    posts.append(parsed)

                except Exception as exc:
                    logging.error("Failed to parse detail page %s: %s", detail_url, exc)
                    continue

        browser.close()

    return posts