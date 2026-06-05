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
    post["title"] = _clean_text(post.get("title", ""))
    post["content"] = _clean_text(post.get("content", ""))
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
