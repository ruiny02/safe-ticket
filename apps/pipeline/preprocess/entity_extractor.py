import re

PHONE_PATTERN = re.compile(r"\b(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})\b")

ACCOUNT_PATTERN = re.compile(
    r"(?i)\b(?:(국민|국민은행|신한|신한은행|카카오|카카오뱅크|카뱅|토스|농협|농협은행|우리|우리은행|하나|하나은행|기업|기업은행)\s*)?"
    r"(\d{2,4}(?:[-\s]?\d{2,6}){2,4})\b"
)

ACCOUNT_CONTEXT_PATTERN = re.compile(
    r"(?i)(계좌|계좌번호|입금|송금|이체|은행|국민|신한|카카오|카카오뱅크|카뱅|토스|농협|우리|하나|기업)"
)

KAKAO_PATTERN = re.compile(
    r"(?i)\b(?:"
    r"(?:카톡|카카오톡|kakaotalk|kakao(?:talk)?|오픈채팅|오픈카톡|openchat)(?:\s*ID)?[:\s\-]*([A-Za-z0-9._-]{4,20})"
    r"|"
    r"([A-Za-z0-9._-]{4,20})\s*(?:카톡|카카오톡|kakaotalk|kakao(?:talk)?|오픈채팅|오픈카톡|openchat)"
    r")\b"
)

SAFE_PAYMENT_PHRASES = [
    "안전결제 안함",
    "안전결제 안 해요",
    "안전결제 불가",
    "안전결제 x",
    "안전거래 불가",
    "안전거래 안함",
    "안전거래 안 해요",
    "번개페이 안함",
    "번개페이 불가",
    "수수료 때문에 안전결제 불가",
]

DIRECT_DEPOSIT_PHRASES = [
    "계좌이체만",
    "선입금",
    "입금 먼저",
    "먼저 입금",
    "입금 확인 후",
    "계좌 먼저",
    "예약금",
    "계약금",
    "부분입금",
    "일부 선입금",
    "입금순",
]

EXTERNAL_MESSENGER_PHRASES = [
    "카톡으로 연락",
    "카톡 주세요",
    "카톡문의",
    "카카오톡",
    "오픈채팅",
    "오픈카톡",
    "톡 주세요",
    "문자 주세요",
    "텔레그램",
    "telegram",
    "kakaotalk",
    "ㄲ ㅑ",
    "ㄲㅑ",
    "툒",
    "친규추가",
    "친구추가",
]

URGENCY_PHRASES = [
    "급처",
    "오늘만",
    "빨리 가져가실 분",
    "급하게 판매",
    "급전",
    "마감 임박",
]

REFUND_DENIAL_PHRASES = [
    "배송 후 환불 불가",
    "환불 안됨",
    "환불 불가",
    "거래 후 환불 불가",
    "취소 불가",
]

TICKET_SPECIFIC_RISK_PHRASES = [
    "배송지 변경",
    "배송지변경",
    "선배송지변경",
    "명의 변경",
    "명의변경",
    "명의 변경 불가",
    "명의변경 불가",
    "대리수령",
    "현장수령",
    "예매번호만 전달",
    "예매번호 전달",
    "모바일티켓 전달",
    "모바일 티켓 전달",
    "qr 전달",
    "qr코드 전달",
    "바코드 전달",
    "아옮",
    "아이디 옮기기",
    "팔옮",
    "팔뜯",
    "예매처로 즉시 전달",
    "예매처로 전달",
    "현장도움",
    "캡처본 인증",
    "캡쳐본 인증",
    "신분증 인증 가능",
    "민증 인증 가능",
    "원가 이하 급처",
    "예매내역 캡처",
    "예매내역 캡쳐",
]

PLATFORM_PURCHASE_AVOIDANCE_PHRASES = [
    "바로 구매 x",
    "바로 구매X",
    "바로 구매 XX",
    "바로구매 x",
    "바로구매X",
    "바로구매 XX",
    "바로 구매하시지 마시고",
    "개인결제창",
    "개인 결제창",
    "채팅은 확인느려요",
    "채팅은 확인 느려요",
]

BROKER_LIKE_INVENTORY_PHRASES = [
    "전지역",
    "전체지역",
    "전체일정",
    "전일정",
    "원하시는 지역",
    "원하시는 날짜",
    "보유좌석",
    "잔여좌석",
    "회차별 좌석",
]

VERIFICATION_ONLY_PHRASES = [
    "인증 가능",
    "인증해드",
    "예매내역 인증",
    "예매 내역 인증",
    "구매내역 인증",
    "구매 내역 인증",
    "캡처 인증",
    "캡쳐 인증",
    "화면 인증",
]

LOW_PRICE_OR_RUSH_PHRASES = [
    "원가 이하",
    "정가 이하",
    "반값",
    "시세보다 싸게",
    "싸게 넘",
    "싸게 양도",
    "급처합니다",
    "급처해요",
]


def extract_phone(text: str) -> str:
    match = PHONE_PATTERN.search(text or "")
    if not match:
        return ""

    return "-".join(match.groups())


def extract_bank_account(text: str) -> str:
    if not text:
        return ""

    for match in ACCOUNT_PATTERN.finditer(text):
        account_text = match.group(0)

        if PHONE_PATTERN.fullmatch(account_text):
            continue

        context_start = max(0, match.start() - 16)
        context_end = min(len(text), match.end() + 16)
        context = text[context_start:context_end]

        if not ACCOUNT_CONTEXT_PATTERN.search(context):
            continue

        digits = re.sub(r"[^0-9]", "", account_text)
        if len(digits) < 8:
            continue

        return re.sub(r"\s+", "", account_text)

    return ""


def extract_kakao_id(text: str) -> str:
    if not text:
        return ""

    match = KAKAO_PATTERN.search(text)
    if not match:
        return ""

    return match.group(1) or match.group(2) or ""


def _contains_any_phrase(text: str, phrases: list[str]) -> bool:
    lower_text = (text or "").lower()
    return any(phrase.lower() in lower_text for phrase in phrases)


def _build_detection_text(post: dict) -> str:
    primary_parts = [
        post.get("title", ""),
        post.get("content", ""),
    ]
    primary_text = " ".join(part for part in primary_parts if part)
    if primary_text.strip():
        return primary_text

    return " ".join(
        [
            post.get("title", ""),
            post.get("rendered_text", ""),
        ]
    )


def build_risk_flags(post: dict) -> list[str]:
    flags = []

    combined_text = _build_detection_text(post)

    if _contains_any_phrase(combined_text, SAFE_PAYMENT_PHRASES):
        flags.append("safe_payment_evasion")

    if _contains_any_phrase(combined_text, DIRECT_DEPOSIT_PHRASES):
        flags.append("direct_deposit_request")

    if _contains_any_phrase(combined_text, EXTERNAL_MESSENGER_PHRASES):
        flags.append("external_messenger_inducement")

    if _contains_any_phrase(combined_text, URGENCY_PHRASES):
        flags.append("urgency_signal")

    if _contains_any_phrase(combined_text, REFUND_DENIAL_PHRASES):
        flags.append("refund_denial")

    if _contains_any_phrase(combined_text, TICKET_SPECIFIC_RISK_PHRASES):
        flags.append("ticket_specific_risk")

    if _contains_any_phrase(combined_text, PLATFORM_PURCHASE_AVOIDANCE_PHRASES):
        flags.append("platform_purchase_avoidance")

    if _contains_any_phrase(combined_text, BROKER_LIKE_INVENTORY_PHRASES):
        flags.append("broker_like_inventory_signal")

    if _contains_any_phrase(combined_text, VERIFICATION_ONLY_PHRASES):
        flags.append("verification_only_claim")

    if _contains_any_phrase(combined_text, LOW_PRICE_OR_RUSH_PHRASES):
        flags.append("low_price_or_rush_signal")

    if post.get("phone_number"):
        flags.append("entity_phone_found")

    if post.get("account_number"):
        flags.append("entity_account_found")

    if post.get("kakao_id"):
        flags.append("entity_kakao_found")

    if "safe_payment_evasion" in flags and "direct_deposit_request" in flags:
        flags.append("payment_flow_high_risk")

    if "external_messenger_inducement" in flags and (
        "entity_account_found" in flags or "entity_kakao_found" in flags
    ):
        flags.append("off_platform_contact_high_risk")

    return flags


def enrich_post_with_entities(post: dict) -> dict:
    combined_text = _build_detection_text(post)

    post["phone_number"] = extract_phone(combined_text)
    post["account_number"] = extract_bank_account(combined_text)
    post["kakao_id"] = extract_kakao_id(combined_text)
    post["risk_flags"] = build_risk_flags(post)
    post["text_for_embedding"] = build_text_for_embedding(post)

    return post


def build_text_for_embedding(post: dict) -> str:
    parts = []

    if post.get("title"):
        parts.append(f"title: {post['title']}")

    if post.get("content"):
        parts.append(f"content: {post['content']}")

    if post.get("platform"):
        parts.append(f"platform: {post['platform']}")

    if post.get("price"):
        parts.append(f"price: {post['price']}")

    if post.get("seller_id"):
        parts.append(f"seller: {post['seller_id']}")

    if post.get("risk_flags"):
        parts.append(f"risk_flags: {', '.join(post['risk_flags'])}")

    return " | ".join(parts)
