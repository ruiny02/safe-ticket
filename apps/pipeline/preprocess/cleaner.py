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

BOILERPLATE_EXACT_LINES = {
    "앱을 다운로드하고 더 편리한 번개장터를 만나보세요!",
    "로그인/회원가입",
    "카테고리",
    "판매자센터",
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
    "개인정보(거래정보)를 주고받는 행위",
    "중고나라로 신고",
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
    "상품 정보가 자세히 적혀있어요",
    "번개톡 답변이 빨라요",
    "친절하고 배려가 넘쳐요",
    "상품 설명과 실제 상품이 동일해요",
    "배송이 빨라요",
    "포장이 깔끔해요",
    "http://",
    "https://",
    "보다 빠른 판매가 가능합니다",
    "내가 가진 커피",
    "편의점 e쿠폰",
    "티켓명(ex.",
    "EMAIL :",
    "FAX :",
    "주소 :",
    "사업자정보 확인",
    "쿠팡",
    "캐시적립",
    "로켓프레시",
    "광고",
]

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

PERFORMANCE_TICKET_KEYWORDS = [
    keyword for keyword in TICKET_KEYWORDS if keyword not in {"티켓"}
]

TICKET_TRADE_CONTEXT_KEYWORDS = [
    "티켓",
    "입장권",
    "좌석",
    "구역",
    "열",
    "연석",
    "단석",
    "스탠딩",
    "예매",
    "양도",
    "원가양도",
    "정가양도",
    "배송지변경",
    "아옮",
    "예매번호",
]

LIVE_TICKET_CONTEXT_KEYWORDS = [
    "양도",
    "좌석",
    "구역",
    "열",
    "연석",
    "단석",
    "스탠딩",
    "예매",
    "입장권",
    "공연",
    "콘서트",
    "뮤지컬",
    "팬미팅",
    "전시회",
    "경기",
]

NON_TICKET_GOODS_KEYWORDS = [
    "ost",
    "OST",
    "음반",
    "앨범",
    "포토카드",
    "포카",
    "굿즈",
    "메모리북",
    "프로그램북",
    "플북",
    "시리즈 티켓",
    "우정티켓",
    "스페셜티켓",
    "티켓풍",
]


def clean_post(post: dict) -> dict:
    raw_title = post.get("title", "")
    raw_content = post.get("content", "")
    title = _clean_text(raw_title)
    content = _extract_listing_content(raw_content, title, post.get("platform", ""))

    if _is_generic_title(title):
        title = _extract_listing_title(raw_content, post.get("price", "")) or title

    post["title"] = title
    post["content"] = _clean_listing_text(content)
    post["price"] = _normalize_price(post.get("price", ""))
    post["price_int"] = _parse_price_to_int(post.get("price", ""))
    post["seller_id"] = _clean_text(post.get("seller_id", ""))
    post["rendered_text"] = _build_canonical_rendered_text(post["title"], post["price"], post["content"])
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
        focused = _drop_warning_lines(focused or lines, platform=platform)
        return "\n".join(focused)

    if platform == "bungaejangter":
        focused = _slice_after_quantity_until(lines, ["배송비", "구매하기", "상점정보/후기"])
        if focused:
            return "\n".join(_drop_warning_lines(focused, platform=platform))

    if title:
        for index, line in enumerate(lines):
            if line == title:
                return "\n".join(lines[index : index + 20])

    return "\n".join(lines)


def _clean_lines(text: str) -> list[str]:
    text = re.sub(r"<[^>]+>", " ", text or "")
    lines = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        if _is_boilerplate_line(line):
            continue
        if _is_trade_ui_line(line):
            continue
        if re.fullmatch(r"\d+", line):
            continue
        lines.append(line)
    return lines


def _clean_listing_text(text: str) -> str:
    return "\n".join(_clean_lines(text))


def _build_canonical_rendered_text(title: str, price: str, content: str) -> str:
    return "\n".join(part for part in [title, price, content] if part)


def _is_boilerplate_line(line: str) -> bool:
    if line in BOILERPLATE_EXACT_LINES:
        return True
    if _is_seller_metric_line(line):
        return True
    return any(token in line for token in BOILERPLATE_CONTAINS)


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
        if any(marker in lines[index] for marker in end_markers) or _is_seller_metric_line(lines[index]):
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
        if any(marker in lines[index] for marker in end_markers) or _is_seller_metric_line(lines[index]):
            end = index
            break

    return lines[start:end]


def _drop_warning_lines(lines: list[str], platform: str = "") -> list[str]:
    return [
        line
        for line in lines
        if not _is_boilerplate_line(line)
        and not _is_trade_ui_line(line)
        and not (platform == "bungaejangter" and _is_seller_metric_line(line))
    ]


def _is_trade_ui_line(line: str) -> bool:
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
    return False


def _is_seller_metric_line(line: str) -> bool:
    if line in {"팔로우", "만족후기"}:
        return True
    if re.fullmatch(r"후기\s*\d+", line):
        return True
    if re.fullmatch(r"거래내역\s*\d+", line):
        return True
    if re.fullmatch(r"\d+%", line):
        return True
    return False


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

    if _is_generic_title(title) and not any(keyword in content for keyword in PERFORMANCE_TICKET_KEYWORDS):
        return False, "generic_ticket_category_only"

    if not content:
        return False, "empty_content"

    if not any(keyword in combined for keyword in TICKET_TRADE_CONTEXT_KEYWORDS):
        return False, "missing_ticket_trade_context"

    if post.get("platform") == "bungaejangter" and not any(keyword in combined for keyword in LIVE_TICKET_CONTEXT_KEYWORDS):
        return False, "missing_live_ticket_context"

    if _looks_like_non_ticket_goods(title, content):
        return False, "non_ticket_goods"

    if len(combined) < 20:
        return False, "insufficient_text"

    if not any(keyword in combined for keyword in TICKET_KEYWORDS):
        return False, "not_ticket_related"

    return True, "valid"


def _looks_like_non_ticket_goods(title: str, content: str) -> bool:
    combined = f"{title} {content}"
    has_goods_keyword = any(keyword in combined for keyword in NON_TICKET_GOODS_KEYWORDS)
    if not has_goods_keyword:
        return False

    has_live_ticket_context = any(
        keyword in combined
        for keyword in ["좌석", "구역", "열", "연석", "단석", "스탠딩", "예매", "입장권"]
    )
    return not has_live_ticket_context
