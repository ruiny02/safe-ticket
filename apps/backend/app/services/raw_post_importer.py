"""Import raw marketplace posts into backend-owned RAG memory tables."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.models import Case, CaseChunk, CaseEntity, RawPost, SellerObservation
from app.db.session import SessionLocal
from app.schemas.raw_post import RawPostImportResponse
from app.services.risk_rules import assess_ticket_fraud_risk


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

RISK_PHRASES = [
    "안전결제 안함",
    "안전결제 불가",
    "안전거래 불가",
    "번개페이 안함",
    "선입금",
    "입금 먼저",
    "계좌이체만",
    "카톡",
    "오픈채팅",
    "급처",
    "환불 불가",
    "배송지 변경",
    "명의변경",
    "예매번호 전달",
    "모바일티켓 전달",
    "qr 전달",
    "바로 구매 x",
]

GENERIC_TITLES = {
    "",
    "도서/티켓/문구",
    "티켓",
    "콘서트",
    "상품",
    "번개장터",
    "중고나라",
    "영화(예매/관람권)",
    "공연/전시/행사",
}

TITLE_KEYWORDS = (
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
)


@dataclass
class RawPostImportResult:
    raw_posts_seen: int = 0
    cases_created: int = 0
    cases_updated: int = 0
    chunks_created: int = 0
    entities_created: int = 0
    seller_observations_created: int = 0
    risk_level_counts: dict[str, int] | None = None

    def to_response(self) -> RawPostImportResponse:
        return RawPostImportResponse(**self.__dict__)


def import_raw_posts_to_cases(limit: int | None = None) -> RawPostImportResponse:
    """Import stored raw posts into cases, chunks, entities, and seller observations."""
    with SessionLocal() as db:
        query = db.query(RawPost).order_by(RawPost.crawled_at.asc().nullslast(), RawPost.raw_post_id.asc())
        if limit is not None:
            query = query.limit(limit)

        rows = query.all()
        result = RawPostImportResult(raw_posts_seen=len(rows), risk_level_counts={})

        for raw_post in rows:
            _upsert_case_graph(db, raw_post, result)

        db.commit()
        return result.to_response()


def _upsert_case_graph(db: Session, raw_post: RawPost, result: RawPostImportResult) -> None:
    case_id = build_case_id(raw_post)
    title = build_case_title(raw_post)
    body = build_case_body(raw_post)
    risk = assess_ticket_fraud_risk(raw_post.title, raw_post.content, raw_post.rendered_text)
    if result.risk_level_counts is not None:
        result.risk_level_counts[risk.risk_level] = result.risk_level_counts.get(risk.risk_level, 0) + 1
    summary = build_case_summary(raw_post, title, risk.risk_flags)
    label = build_case_label(risk.risk_level)

    case = db.get(Case, case_id)
    if case is None:
        case = Case(case_id=case_id)
        db.add(case)
        result.cases_created += 1
    else:
        result.cases_updated += 1
        db.execute(delete(CaseChunk).where(CaseChunk.case_id == case_id))
        db.execute(delete(CaseEntity).where(CaseEntity.case_id == case_id))

    case.source_type = "marketplace_raw_post"
    case.source_url = raw_post.source_url
    case.title = title
    case.body = body
    case.label = label
    case.risk_level = risk.risk_level
    case.risk_score = risk.risk_score
    case.risk_flags_json = risk.risk_flags
    case.summary = summary
    case.platform_hint = raw_post.platform

    for order, chunk_text in enumerate(split_case_chunks(body), start=1):
        db.add(CaseChunk(case_id=case_id, chunk_order=order, chunk_text=chunk_text))
        result.chunks_created += 1

    for entity_type, raw_value in iter_case_entities(raw_post):
        db.add(
            CaseEntity(
                case_id=case_id,
                entity_type=entity_type,
                entity_value_raw=raw_value,
                entity_value_hash=hash_entity_value(raw_value),
            )
        )
        result.entities_created += 1

    seller_observation = build_seller_observation(db, raw_post)
    if seller_observation is not None:
        db.add(seller_observation)
        result.seller_observations_created += 1


def build_case_id(raw_post: RawPost) -> str:
    stable_source = raw_post.source_url or f"{raw_post.platform}:{raw_post.raw_post_id}"
    digest = hashlib.sha256(stable_source.encode("utf-8")).hexdigest()[:16]
    return f"case_{digest}"


def build_case_body(raw_post: RawPost) -> str:
    parts = [
        raw_post.title or "",
        raw_post.content or "",
        raw_post.rendered_text or "",
    ]
    body = "\n\n".join(part.strip() for part in parts if part and part.strip())
    return body or "(empty marketplace raw post)"


def build_case_title(raw_post: RawPost) -> str:
    title = (raw_post.title or "").strip()
    if title not in GENERIC_TITLES:
        return title

    text = raw_post.content or raw_post.rendered_text or ""
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if _looks_like_listing_title(line):
            return line

    return title or "(untitled marketplace post)"


def _looks_like_listing_title(line: str) -> bool:
    if line in GENERIC_TITLES:
        return False
    if len(line) < 4 or len(line) > 140:
        return False
    return any(keyword in line for keyword in TITLE_KEYWORDS)


def build_case_summary(
    raw_post: RawPost,
    title: str | None = None,
    risk_flags: list[str] | None = None,
    max_length: int = 220,
) -> str:
    title = (title or raw_post.title or "").strip()
    signals = risk_flags or []

    if title and signals:
        return f"{title} / signals: {', '.join(signals[:4])}"

    summary_source = title or build_case_body(raw_post)
    if len(summary_source) <= max_length:
        return summary_source
    return summary_source[: max_length - 3].rstrip() + "..."


def build_case_label(risk_level: str) -> str:
    return f"risk_{risk_level}"


def split_case_chunks(text: str, max_chars: int = 900) -> list[str]:
    normalized = " ".join((text or "").split())
    if not normalized:
        return ["(empty marketplace raw post)"]

    return [normalized[index : index + max_chars].strip() for index in range(0, len(normalized), max_chars)]


def iter_case_entities(raw_post: RawPost) -> Iterable[tuple[str, str]]:
    text = build_case_body(raw_post)

    phone = extract_phone(text)
    if phone:
        yield "phone", phone

    account = extract_bank_account(text)
    if account:
        yield "account", account

    kakao_id = extract_kakao_id(text)
    if kakao_id:
        yield "messenger", kakao_id

    if raw_post.seller_id:
        yield "seller", raw_post.seller_id


def build_seller_observation(db: Session, raw_post: RawPost) -> SellerObservation | None:
    if not raw_post.seller_id:
        return None

    existing = (
        db.query(SellerObservation)
        .filter(
            SellerObservation.platform == raw_post.platform,
            SellerObservation.seller_id == raw_post.seller_id,
            SellerObservation.source_ref == raw_post.source_url,
        )
        .one_or_none()
    )
    if existing is not None:
        return None

    text = build_case_body(raw_post)
    return SellerObservation(
        platform=raw_post.platform,
        seller_id=raw_post.seller_id,
        nickname=raw_post.seller_id,
        account_hash=hash_entity_value(extract_bank_account(text)),
        phone_hash=hash_entity_value(extract_phone(text)),
        messenger_hash=hash_entity_value(extract_kakao_id(text)),
        source_ref=raw_post.source_url,
    )


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
        if not ACCOUNT_CONTEXT_PATTERN.search(text[context_start:context_end]):
            continue

        digits = re.sub(r"[^0-9]", "", account_text)
        if len(digits) < 8:
            continue

        return re.sub(r"\s+", "", account_text)

    return ""


def extract_kakao_id(text: str) -> str:
    match = KAKAO_PATTERN.search(text or "")
    if not match:
        return ""
    return match.group(1) or match.group(2) or ""


def hash_entity_value(raw_value: str | None) -> str | None:
    normalized = "".join(str(raw_value or "").split()).lower()
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
