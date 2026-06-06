"""Create a balanced 100-record processed dataset from clean ticket posts."""

from __future__ import annotations

import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = BASE_DIR / "data" / "processed" / "processed_posts.jsonl"
DEFAULT_OUTPUT = BASE_DIR / "data" / "processed" / "augmented_100_processed_posts.jsonl"

EVENTS = [
    ("데이식스 서울 콘서트", "KSPO DOME"),
    ("세븐틴 팬미팅", "잠실실내체육관"),
    ("뮤지컬 데스노트", "충무아트센터"),
    ("뮤지컬 드라큘라", "샤롯데씨어터"),
    ("선셋롤러코스터 내한공연", "KBS아레나"),
    ("울산뮤직페스티벌", "울산종합운동장"),
    ("연극 비밀통로", "대학로 아트원씨어터"),
    ("팬텀싱어 갈라콘서트", "올림픽홀"),
    ("서울 재즈 페스티벌", "난지한강공원"),
    ("프로야구 잠실 경기", "잠실야구장"),
    ("전시회 얼리버드 입장권", "코엑스 전시장"),
    ("크리스토퍼 내한공연", "인스파이어 아레나"),
]

SEATS = [
    "1층 8구역 12열 2연석",
    "스탠딩 R구역 40번대 단석",
    "VIP석 B구역 3열 1매",
    "2층 중앙블럭 6열 2매",
    "S석 C구역 10열 1매",
    "플로어 A구역 20번대 2연석",
    "3루 레드석 225구역 10열 2장",
    "R석 1층 중블 4열 1매",
]

DATES = [
    "7월 3일 금요일 19시",
    "7월 5일 일요일 17시",
    "7월 11일 토요일 14시",
    "7월 19일 일요일 18시",
    "8월 2일 토요일 19시 30분",
    "8월 16일 일요일 16시",
    "9월 6일 토요일 18시",
    "9월 20일 일요일 15시",
]

PRICE_VALUES = [
    25000,
    40000,
    77000,
    88000,
    104000,
    125000,
    150000,
    170000,
    190000,
    220000,
]


def load_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            if line.strip():
                records.append(json.loads(line))
    return records


def write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def format_price(value: int) -> str:
    return f"{value:,}"


def build_augmented_record(index: int, target_level: str) -> dict:
    event, venue = EVENTS[index % len(EVENTS)]
    seat = SEATS[(index * 3) % len(SEATS)]
    date = DATES[(index * 5) % len(DATES)]
    price_int = PRICE_VALUES[(index * 7) % len(PRICE_VALUES)]
    price = format_price(price_int)

    title = f"{event} {seat} 티켓 양도"
    lines = [
        f"{date} {venue} 공연 티켓입니다.",
        f"좌석은 {seat}이고 가격은 장당 {price}원입니다.",
    ]
    risk_flags: list[str] = []

    if target_level == "low":
        low_variants = [
            "예매 내역 인증 가능하고 일정이 안 맞아 양도합니다.",
            "정가 이하로 올렸고 현장 수령에 필요한 정보는 거래 시 정리해서 드립니다.",
            "직거래 가능하며 공연 관람하실 분께 양도합니다.",
        ]
        lines.append(low_variants[index % len(low_variants)])
        if index % 3 == 0:
            risk_flags.append("verification_only_claim")
        if index % 3 == 1:
            risk_flags.append("low_price_or_rush_signal")
    elif target_level == "medium":
        medium_variants = [
            "배송지변경으로 양도 가능하고 예매 내역 인증 가능합니다.",
            "예매번호 전달 방식이며 거래 후 일정 변경은 어렵습니다.",
            "전지역 공연 회차별 좌석 문의 가능하고 원하시는 날짜 말씀해주세요.",
            "아옮으로 진행하며 실패 시에는 금액을 돌려드립니다.",
        ]
        lines.append(medium_variants[index % len(medium_variants)])
        risk_flags.extend(["ticket_specific_risk"])
        if index % 2 == 0:
            risk_flags.append("verification_only_claim")
    else:
        high_variants = [
            "안전결제 불가하고 선입금 확인 후 예매번호 전달합니다.",
            "바로 구매하지 마시고 오픈채팅으로 연락 주세요. 입금 먼저 부탁드립니다.",
            "번개페이 불가, 계좌이체만 가능하며 환불 불가 조건입니다.",
        ]
        lines.append(high_variants[index % len(high_variants)])
        risk_flags.extend(["payment_flow_high_risk", "safe_payment_evasion"])
        if index % 3 == 1:
            risk_flags.append("off_platform_contact")

    content = "\n".join(lines)
    text_for_embedding = f"title: {title} | content: {content}"
    if risk_flags:
        text_for_embedding += f" | risk_flags: {', '.join(risk_flags)}"

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    source_url = f"synthetic://safe-ticket/augmented/{index:04d}"
    quality_flags = [
        "has_title",
        "has_content",
        "has_price",
        "ticket_related",
        "synthetic_augmented",
    ]
    if risk_flags:
        quality_flags.append("has_risk_flags")

    return {
        "platform": "joonggonara",
        "url": source_url,
        "title": title,
        "content": content,
        "price": price,
        "seller_id": "",
        "rendered_text": f"{title}\n{price}\n{content}",
        "crawled_at": now,
        "price_int": price_int,
        "validation_reason": "synthetic_augmented",
        "is_valid_post": True,
        "phone_number": "",
        "account_number": "",
        "kakao_id": "",
        "risk_flags": risk_flags,
        "text_for_embedding": text_for_embedding,
        "data_quality_score": 80 if risk_flags else 60,
        "quality_flags": quality_flags,
        "backend_payload": {
            "raw_text": content,
            "platform": "joonggonara",
            "url": source_url,
            "title": title,
            "price": price,
            "price_int": price_int,
            "seller_info": {"seller_id": ""},
            "extracted_entities": {
                "phone_number": "",
                "account_number": "",
                "kakao_id": "",
            },
            "rule_flags": risk_flags,
            "text_for_embedding": text_for_embedding,
            "data_quality_score": 80 if risk_flags else 60,
            "quality_flags": quality_flags,
        },
    }


def clone_original(record: dict) -> dict:
    cloned = copy.deepcopy(record)
    flags = cloned.setdefault("quality_flags", [])
    if "real_crawled" not in flags:
        flags.append("real_crawled")
    return cloned


def augment_to_target(records: list[dict], target_count: int) -> list[dict]:
    if len(records) > target_count:
        raise SystemExit(f"Input has {len(records)} records, greater than target {target_count}")

    augmented = [clone_original(record) for record in records]
    needed = target_count - len(augmented)

    level_plan = (
        ["low"] * 31
        + ["medium"] * 20
        + ["high"] * 10
    )

    for offset in range(needed):
        level = level_plan[offset % len(level_plan)]
        augmented.append(build_augmented_record(offset + 1, level))

    return augmented


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a 100-record augmented processed JSONL dataset.")
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--target-count", type=int, default=100)
    args = parser.parse_args()

    source = Path(args.input)
    output = Path(args.output)
    records = load_jsonl(source)
    augmented = augment_to_target(records, args.target_count)
    write_jsonl(output, augmented)

    synthetic_count = sum(1 for record in augmented if str(record.get("url", "")).startswith("synthetic://"))
    print(
        f"Wrote {len(augmented)} records to {output} "
        f"({len(records)} real, {synthetic_count} synthetic)."
    )


if __name__ == "__main__":
    main()
