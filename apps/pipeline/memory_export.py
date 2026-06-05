"""Build backend-importable fraud memory records without writing backend tables."""

import hashlib
import json
from pathlib import Path
from typing import Iterable


def save_memory_cases_jsonl(posts: Iterable[dict], output_path: Path) -> dict[str, int]:
    """Write unique backend RAG import records to a JSONL artifact."""
    seen_case_ids = set()
    written = 0
    skipped = 0

    with output_path.open("w", encoding="utf-8") as handle:
        for post in posts:
            record = build_memory_case_record(post)
            case_id = record["case"]["case_id"]

            if case_id in seen_case_ids:
                skipped += 1
                continue

            seen_case_ids.add(case_id)
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1

    return {
        "memory_cases_written": written,
        "memory_cases_skipped": skipped,
    }


def build_memory_case_record(post: dict) -> dict:
    """Return one self-contained source record for backend-owned RAG ingestion."""
    case_id = build_case_id(post)

    return {
        "case": {
            "case_id": case_id,
            "source_type": "marketplace_crawl",
            "source_url": post.get("url", ""),
            "title": post.get("title", ""),
            "body": build_case_body(post),
            "label": build_case_label(post),
            "summary": build_case_summary(post),
            "platform_hint": post.get("platform", "unknown"),
        },
        "chunks": [
            {
                "chunk_order": order,
                "chunk_text": chunk_text,
            }
            for order, chunk_text in enumerate(split_case_chunks(post), start=1)
        ],
        "entities": [
            {
                "entity_type": entity_type,
                "entity_value_raw": raw_value,
                "entity_value_hash": hash_entity_value(raw_value),
            }
            for entity_type, raw_value in iter_case_entities(post)
        ],
        "seller_observation": {
            "platform": post.get("platform", "unknown"),
            "seller_id": post.get("seller_id") or None,
            "nickname": post.get("seller_id") or None,
            "account_hash": hash_entity_value(post.get("account_number", "")),
            "phone_hash": hash_entity_value(post.get("phone_number", "")),
            "messenger_hash": hash_entity_value(post.get("kakao_id", "")),
            "source_ref": post.get("url", ""),
        },
        "pipeline_metadata": {
            "price": post.get("price", ""),
            "price_int": post.get("price_int", 0),
            "risk_flags": post.get("risk_flags", []),
            "quality_flags": post.get("quality_flags", []),
            "data_quality_score": post.get("data_quality_score", 0),
            "validation_reason": post.get("validation_reason", ""),
            "text_for_embedding": post.get("text_for_embedding", ""),
        },
    }


def build_case_id(post: dict) -> str:
    stable_source = post.get("url") or "|".join(
        [
            post.get("platform", "unknown"),
            post.get("title", ""),
            post.get("seller_id", ""),
        ]
    )
    digest = hashlib.sha256(stable_source.encode("utf-8")).hexdigest()[:16]
    return f"case_{digest}"


def build_case_body(post: dict) -> str:
    body_parts = [
        post.get("title", ""),
        post.get("content", ""),
        post.get("rendered_text", ""),
    ]
    body = "\n\n".join(part.strip() for part in body_parts if part and part.strip())
    return body or post.get("text_for_embedding", "") or "(empty marketplace case)"


def build_case_label(post: dict) -> str:
    if post.get("risk_flags"):
        return "fraud_signal"
    return "unlabeled"


def build_case_summary(post: dict, max_length: int = 220) -> str:
    title = (post.get("title") or "").strip()
    flags = post.get("risk_flags") or []

    if title and flags:
        return f"{title} / signals: {', '.join(flags[:4])}"

    summary_source = title or build_case_body(post)
    if len(summary_source) <= max_length:
        return summary_source
    return summary_source[: max_length - 3].rstrip() + "..."


def split_case_chunks(post: dict, max_chars: int = 900) -> list[str]:
    text = post.get("text_for_embedding") or build_case_body(post)
    text = " ".join(text.split())

    if not text:
        return ["(empty marketplace case)"]

    chunks = []
    start = 0

    while start < len(text):
        end = min(start + max_chars, len(text))
        chunks.append(text[start:end].strip())
        start = end

    return chunks


def iter_case_entities(post: dict):
    entity_fields = [
        ("phone", post.get("phone_number", "")),
        ("account", post.get("account_number", "")),
        ("messenger", post.get("kakao_id", "")),
        ("seller", post.get("seller_id", "")),
    ]

    for entity_type, raw_value in entity_fields:
        if raw_value:
            yield entity_type, raw_value


def hash_entity_value(raw_value: str) -> str | None:
    normalized = "".join(str(raw_value or "").split()).lower()
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
