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
    "인터파크",
    "티켓링크",
    "멜론티켓",
    "YES24",
]


def calculate_quality_score(post: dict) -> dict:
    score = 0
    quality_flags = []

    combined_text = " ".join(
        [
            post.get("title", ""),
            post.get("content", ""),
        ]
    )

    if post.get("title"):
        score += 10
        quality_flags.append("has_title")

    if post.get("content"):
        score += 20
        quality_flags.append("has_content")

    if post.get("price"):
        score += 10
        quality_flags.append("has_price")

    if post.get("seller_id"):
        score += 10
        quality_flags.append("has_seller")

    if any(keyword in combined_text for keyword in TICKET_KEYWORDS):
        score += 20
        quality_flags.append("ticket_related")

    if post.get("risk_flags"):
        score += 20
        quality_flags.append("has_risk_flags")

    if post.get("phone_number") or post.get("account_number") or post.get("kakao_id"):
        score += 10
        quality_flags.append("has_extracted_entity")

    post["data_quality_score"] = min(score, 100)
    post["quality_flags"] = quality_flags

    return post
