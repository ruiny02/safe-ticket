import re

INVALID_TITLES = {
    "판매자센터",
    "로그인",
    "회원가입",
    "카테고리",
    "번개장터",
    "중고나라",
    "검색",
    "찜",
}

GENERIC_TITLES = {
    "도서/티켓/문구",
    "티켓",
    "콘서트",
    "상품",
}

TICKET_KEYWORDS = [
    "티켓",
    "콘서트",
    "양도",
    "예매",
    "좌석",
    "공연",
    "팬미팅",
    "뮤지컬",
    "페스티벌",
    "연석",
    "구역",
    "열",
    "회차",
    "원가양도",
    "정가양도",
    "플미",
    "인터파크",
    "티켓링크",
    "멜론티켓",
    "YES24",
    "예매번호",
    "배송지변경",
]


def clean_post(post: dict) -> dict:
    raw_title = post.get("title", "")
    raw_content = post.get("content", "")
    title = _clean_text(raw_title)
    content = _extract_listing_content(raw_content, title, post.get("platform", ""))

    if _is_generic_title(title):
        title = _extract_listing_title(raw_content, post.get("price", "")) or title

    post["title"] = title
    post["content"] = _clean_text(content)
    post["price"] = _normalize_price(post.get("price", ""))
    post["price_int"] = _parse_price_to_int(post.get("price", ""))
    post["seller_id"] = _clean_text(post.get("seller_id", ""))
    post["rendered_text"] = _clean_text(post.get("rendered_text", ""))
    return post


def _clean_text(text: str) -> str:
    if not text:
        return ""

    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _is_generic_title(title: str) -> bool:
    return not title or title in INVALID_TITLES or title in GENERIC_TITLES


def _extract_listing_title(content: str, price: str = "") -> str:
    lines = _clean_lines(content)
    normalized_price = _normalize_price(price)

    for index, line in enumerate(lines):
        if normalized_price and _normalize_price(line) == normalized_price and index > 0:
            candidate = lines[index - 1]
            if _looks_like_listing_title(candidate):
                return candidate

    for line in lines:
        if _looks_like_listing_title(line):
            return line

    return ""


def _extract_listing_content(content: str, title: str, platform: str = "") -> str:
    lines = _clean_lines(content)
    if not lines:
        return ""

    if platform == "joonggonara":
        focused = _slice_between(lines, ["상품 정보"], ["가게 정보", "판매자 정보", "신뢰지수"])
        return "\n".join(_drop_warning_lines(focused or lines))

    if platform == "bungaejangter":
        focused = _slice_after_quantity_until(lines, ["배송비", "구매하기", "상점정보/후기"])
        if focused:
            return "\n".join(focused)

    if title:
        for index, line in enumerate(lines):
            if line == title:
                return "\n".join(lines[index : index + 20])

    return "\n".join(lines)


def _clean_lines(text: str) -> list[str]:
    text = re.sub(r"<[^>]+>", " ", text or "")
    return [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]


def _looks_like_listing_title(line: str) -> bool:
    if line in INVALID_TITLES or line in GENERIC_TITLES:
        return False
    if len(line) < 4 or len(line) > 120:
        return False
    return any(keyword in line for keyword in TICKET_KEYWORDS)


def _slice_between(lines: list[str], start_markers: list[str], end_markers: list[str]) -> list[str]:
    start = None
    for index, line in enumerate(lines):
        if any(marker in line for marker in start_markers):
            start = index + 1

    if start is None:
        return []

    end = len(lines)
    for index in range(start, len(lines)):
        if any(marker in lines[index] for marker in end_markers):
            end = index
            break

    return lines[start:end]


def _slice_after_quantity_until(lines: list[str], end_markers: list[str]) -> list[str]:
    start = None
    for index, line in enumerate(lines):
        if line == "수량" and index + 1 < len(lines):
            start = index + 2
            break

    if start is None:
        return []

    end = len(lines)
    for index in range(start, len(lines)):
        if any(marker in lines[index] for marker in end_markers):
            end = index
            break

    return lines[start:end]


def _drop_warning_lines(lines: list[str]) -> list[str]:
    return [
        line
        for line in lines
        if "개인정보(거래정보)를 주고받는 행위" not in line
        and "중고나라로 신고" not in line
    ]


def _normalize_price(price_str: str) -> str:
    if not price_str:
        return ""

    price_str = re.sub(r"[₩$€¥]", "", price_str)
    price_str = price_str.replace("원", "")
    price_str = re.sub(r"\s+", "", price_str)
    return price_str.strip()


def _parse_price_to_int(price_str: str) -> int:
    digits = re.sub(r"[^0-9]", "", price_str or "")
    if not digits:
        return 0
    return int(digits)


def validate_post(post: dict) -> tuple[bool, str]:
    title = post.get("title", "").strip()
    content = post.get("content", "").strip()
    rendered_text = post.get("rendered_text", "").strip()

    combined = f"{title} {content} {rendered_text}"

    if not title and not content and not rendered_text:
        return False, "empty_all_text"

    if title in INVALID_TITLES:
        return False, "invalid_navigation_title"

    if len(combined) < 20:
        return False, "insufficient_text"

    if not any(keyword in combined for keyword in TICKET_KEYWORDS):
        return False, "not_ticket_related"

    return True, "valid"
