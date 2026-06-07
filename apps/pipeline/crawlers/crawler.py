import logging
import hashlib
import random
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup
from playwright.sync_api import Page, sync_playwright

from utils.file_utils import save_json, write_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

MARKETPLACE_PAGES = [
    {
        "platform": "joonggonara",
        "search_url_template": "https://web.joongna.com/search/{query}",
        "base_url": "https://web.joongna.com",
        "allowed_tokens": ["/product/", "/products/", "/article/", "/articles/"],
    },
    {
        "platform": "bungaejangter",
        "search_url_template": "https://m.bunjang.co.kr/search/products?q={query}",
        "base_url": "https://m.bunjang.co.kr",
        "allowed_tokens": ["/products/"],
    },
]

SEARCH_QUERIES = [
    "콘서트 티켓 양도",
    "뮤지컬 티켓 양도",
    "페스티벌 티켓 양도",
    "팬미팅 티켓 양도",
    "스포츠 경기 티켓 양도",
    "전시회 티켓 양도",
    "연극 티켓 양도",
    "공연 티켓 원가양도",
    "티켓 배송지변경",
    "티켓 예매번호 전달",
]

BLOCKED_TOKENS = [
    "/search",
    "/favorite",
    "/login",
    "/join",
    "/form",
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

BOILERPLATE_EXACT_LINES = {
    "앱을 다운로드하고 더 편리한 번개장터를 만나보세요!",
    "로그인/회원가입",
    "카테고리",
    "여성의류",
    "남성의류",
    "스포츠/레저",
    "스타굿즈",
    "디지털",
    "키덜트",
    "메루카리",
    "판매자센터",
    "도서/티켓/문구",
    "신고하기",
    "더보기",
    "배송비",
    "무료배송",
    "사용기한",
    "사용기한 표시 없음",
    "수량",
    "1개",
    "시세조회",
    "채팅하기",
    "직거래",
    "택배거래",
    "일반택배",
    "만나서 직거래",
    "상품 상태",
    "새 상품은 어떠세요?",
    "구매하기",
    "상점정보/후기",
    "상점정보/후기 더보기",
    "이 상품과 비슷해요",
    "비슷한 새 상품 보기",
    "파워 링크",
    "AD",
    "회사소개",
    "이용약관",
    "운영정책",
    "개인정보처리방침",
    "청소년보호정책",
    "광고제휴",
    "공지사항",
    "1:1 문의하기",
    "자주 묻는 질문",
}

BOILERPLATE_CONTAINS = [
    "번개장터(주)",
    "Bungaejangter Inc.",
    "사업자등록번호",
    "통신판매업신고",
    "호스팅서비스 제공자",
    "개인정보보호책임자",
    "우리은행 채무지급보증",
    "서비스 가입사실 확인",
    "통신판매중개자",
    "네이버",
    "광고",
    "http://",
    "https://",
    "상품 정보가 자세히 적혀있어요",
    "번개톡 답변이 빨라요",
    "친절하고 배려가 넘쳐요",
    "상품 설명과 실제 상품이 동일해요",
    "배송이 빨라요",
    "포장이 깔끔해요",
    "개인정보(거래정보)를 주고받는 행위",
    "중고나라로 신고",
    "보다 빠른 판매가 가능합니다",
    "내가 가진 커피",
    "편의점 e쿠폰",
    "티켓명(ex.",
    "배송비 ",
    "반값택배",
    "상품 상태",
    "직거래 희망 장소",
    "새상품, 구성품",
    "후기 ",
    "거래내역 ",
    "만족후기",
    "팔로우",
    "구매확정이 빨라요",
    "무리한 네고를 하지 않아요",
    "꼭 필요한 문의만 해요",
]

CONTENT_END_MARKERS = [
    "구매하기",
    "상점정보/후기",
    "이 상품과 비슷해요",
    "비슷한 새 상품 보기",
    "새 상품은 어떠세요?",
    "가게 정보",
    "판매자 정보",
    "신뢰지수",
    "주의하세요",
    "광고",
    "파워 링크",
    "회사소개",
    "후기 ",
    "거래내역 ",
    "팔로우",
    "만족후기",
]


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


def _clean_rendered_lines(rendered_text: str) -> list[str]:
    lines = []
    for line in (rendered_text or "").splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        if line in BOILERPLATE_EXACT_LINES:
            continue
        if any(token in line for token in BOILERPLATE_CONTAINS):
            continue
        if re.fullmatch(r"[\d,]+원?", line):
            lines.append(line)
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if re.fullmatch(r"\d+\s*/\s*\d+", line):
            continue
        if line.startswith("#"):
            continue
        lines.append(line)
    return lines


def _slice_listing_body(lines: list[str], title: str, price: str, platform: str) -> list[str]:
    if not lines:
        return []

    start = None
    normalized_price = _normalize_price(price)

    if platform == "joonggonara":
        for index, line in enumerate(lines):
            if "상품 정보" in line:
                start = index + 1
                break

    if title:
        for index, line in enumerate(lines):
            if start is None and line == title:
                start = index + 1
                break

    if start is None and normalized_price:
        for index, line in enumerate(lines):
            if _normalize_price(line) == normalized_price:
                start = index + 1
                break

    if start is None:
        for index, line in enumerate(lines):
            if _looks_like_content_line(line):
                start = index
                break

    if start is None:
        return []

    end = len(lines)
    for index in range(start, len(lines)):
        if _is_content_end_line(lines[index]):
            end = index
            break

    body_lines = []
    for line in lines[start:end]:
        if line == title:
            continue
        if normalized_price and _normalize_price(line) == normalized_price:
            continue
        if platform == "bungaejangter" and re.fullmatch(r"\d+분 전|\d+시간 전|\d+일 전|\d+달 전", line):
            continue
        if platform == "joonggonara" and _is_joongna_trade_ui_line(line):
            continue
        if platform == "bungaejangter" and _is_bunjang_seller_or_recommendation_line(line):
            break
        if _looks_like_content_line(line):
            body_lines.append(line)

    return body_lines[:24]


def _is_content_end_line(line: str) -> bool:
    if any(marker in line for marker in CONTENT_END_MARKERS):
        return True
    return _is_bunjang_seller_or_recommendation_line(line)


def _is_joongna_trade_ui_line(line: str) -> bool:
    if line in {
        "시세조회",
        "직거래",
        "택배거래",
        "일반택배",
        "만나서 직거래",
        "상품 상태",
        "채팅하기",
        "새 상품은 어떠세요?",
    }:
        return True
    if re.fullmatch(r"배송비\s*[\d,]+원~?", line):
        return True
    if re.fullmatch(r"(CU|GS)?\s*반값택배\s*[\d,]+원", line):
        return True
    if re.fullmatch(r"[\d,]+원", line):
        return True
    return False


def _is_bunjang_seller_or_recommendation_line(line: str) -> bool:
    if line in {"팔로우", "만족후기"}:
        return True
    if re.fullmatch(r"후기\s*\d+", line):
        return True
    if re.fullmatch(r"거래내역\s*\d+", line):
        return True
    if re.fullmatch(r"\d+%", line):
        return True
    if re.fullmatch(r"\d(?:\.\d)?", line):
        return True
    return False


def _looks_like_content_line(line: str) -> bool:
    if len(line) < 2 or line in INVALID_TITLE_LINES:
        return False
    if line in BOILERPLATE_EXACT_LINES:
        return False
    if any(token in line for token in BOILERPLATE_CONTAINS):
        return False
    return True


def _normalize_price(price_str: str) -> str:
    if not price_str:
        return ""
    price_str = re.sub(r"[₩$€¥]", "", price_str)
    price_str = price_str.replace("원", "")
    price_str = re.sub(r"[^0-9]", "", price_str)
    return price_str.strip()


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

    if not price:
        price = _extract_price_from_text(rendered_text)

    clean_lines = _clean_rendered_lines(rendered_text)
    focused_body_lines = _slice_listing_body(clean_lines, title, price, platform)
    if focused_body_lines:
        content = "\n".join(focused_body_lines)
    elif content:
        content = "\n".join(_clean_rendered_lines(content))
    else:
        content = ""

    focused_rendered_text = "\n".join([part for part in [title, price, content] if part])

    return {
        "platform": platform,
        "url": page_url or default_url,
        "title": title,
        "content": content,
        "price": price,
        "seller_id": seller_id,
        "raw_html": html,
        "rendered_text": focused_rendered_text,
        "crawled_at": datetime.utcnow().isoformat() + "Z",
    }


def _build_search_url(page_info: dict[str, Any], query: str) -> str:
    return page_info["search_url_template"].format(query=quote(query))


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

            if not _is_real_listing_url(page_info["platform"], absolute_url):
                continue

            absolute_url = _canonical_listing_url(page_info["platform"], absolute_url)

            if absolute_url not in seen_links:
                seen_links.add(absolute_url)
                links.append(absolute_url)

            if len(links) >= max_links:
                break

        except Exception:
            continue


def _is_real_listing_url(platform: str, absolute_url: str) -> bool:
    if platform == "joonggonara":
        return re.search(r"/product/\d+(?:[/?#]|$)", absolute_url) is not None
    if platform == "bungaejangter":
        return re.search(r"/products/\d+(?:[/?#]|$)", absolute_url) is not None
    return True


def _canonical_listing_url(platform: str, absolute_url: str) -> str:
    if platform == "joonggonara":
        match = re.search(r"(https://web\.joongna\.com/product/\d+)", absolute_url)
        if match:
            return match.group(1)
    if platform == "bungaejangter":
        match = re.search(r"(https://m\.bunjang\.co\.kr/products/\d+)", absolute_url)
        if match:
            return match.group(1)
    return absolute_url


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
            detail_links: list[str] = []
            seen_detail_links: set[str] = set()
            links_per_query = max(1, max_links_per_platform // len(SEARCH_QUERIES))
            extra_budget = max_links_per_platform % len(SEARCH_QUERIES)

            for query_index, query in enumerate(SEARCH_QUERIES):
                if len(detail_links) >= max_links_per_platform:
                    break

                query_limit = links_per_query + (1 if query_index < extra_budget else 0)
                query_limit = min(query_limit, max_links_per_platform - len(detail_links))
                search_url = _build_search_url(page_info, query)
                logging.info("Loading search page for %s query=%s", platform, query)

                if not _goto_with_retries(page, search_url, retries=retries):
                    continue

                time.sleep(random.uniform(1.0, 2.0))

                query_links = _collect_detail_links(
                    page,
                    page_info,
                    max_links=max(query_limit * 2, query_limit),
                    scroll_rounds=scroll_rounds,
                )
                for detail_url in query_links:
                    if detail_url in seen_detail_links:
                        continue
                    seen_detail_links.add(detail_url)
                    detail_links.append(detail_url)
                    if len(detail_links) >= max_links_per_platform or len(detail_links) >= (query_index + 1) * links_per_query + extra_budget:
                        break

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
