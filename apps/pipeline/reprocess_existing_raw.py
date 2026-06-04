"""Rebuild processed, memory, embedding, and DB artifacts from saved raw JSON."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from batch_pipeline import (
    EMBEDDING_CASES_FILE,
    MEMORY_CASES_FILE,
    PROCESSED_FILE,
    RAW_DIR,
    RAW_POSTS_FILE,
    TEXT_PREPROCESSED_FILE,
    build_backend_payload,
    build_raw_post_record,
    build_text_preprocessed_record,
    remove_heavy_fields,
    reset_pipeline_db,
)
from db.connection import get_engine
from db.loader import load_processed_data
from db.models import init_db
from memory_export import save_memory_cases_jsonl
from preprocess.cleaner import clean_post, validate_post
from preprocess.entity_extractor import enrich_post_with_entities
from preprocess.scoring import calculate_quality_score
from rag.embedding_export import save_embedding_cases_jsonl
from rag.repository import load_embedding_cases
from utils.file_utils import ensure_dir, save_jsonl


def load_raw_posts(raw_dir: Path = RAW_DIR) -> list[dict]:
    posts = []
    for path in sorted(raw_dir.glob("parsed_*.json")):
        with path.open("r", encoding="utf-8") as handle:
            post = json.load(handle)
        post["raw_parsed_path"] = str(path)
        posts.append(post)
    return posts


def main() -> None:
    raw_posts = load_raw_posts()
    if not raw_posts:
        raise SystemExit(f"No parsed raw JSON files found under {RAW_DIR}")

    for output_path in (PROCESSED_FILE, TEXT_PREPROCESSED_FILE, MEMORY_CASES_FILE, EMBEDDING_CASES_FILE):
        ensure_dir(output_path.parent)

    cleaned_posts = [clean_post(post) for post in raw_posts]
    valid_posts = []
    invalid_posts = []

    for post in cleaned_posts:
        is_valid, reason = validate_post(post)
        post["validation_reason"] = reason

        if not is_valid:
            post["is_valid_post"] = False
            invalid_posts.append(post)
            continue

        post["is_valid_post"] = True
        post = enrich_post_with_entities(post)
        post = calculate_quality_score(post)
        post["backend_payload"] = build_backend_payload(post)
        valid_posts.append(post)

    output_posts = [remove_heavy_fields(post) for post in valid_posts]
    text_preprocessed_posts = [build_text_preprocessed_record(post) for post in valid_posts]

    save_jsonl(RAW_POSTS_FILE, [build_raw_post_record(post) for post in raw_posts])
    save_jsonl(PROCESSED_FILE, output_posts)
    save_jsonl(TEXT_PREPROCESSED_FILE, text_preprocessed_posts)
    memory_result = save_memory_cases_jsonl(text_preprocessed_posts, MEMORY_CASES_FILE)
    embedding_result = save_embedding_cases_jsonl(text_preprocessed_posts, EMBEDDING_CASES_FILE)

    engine = get_engine()
    try:
        init_db(engine)
        reset_result = reset_pipeline_db(engine)
        load_result = load_processed_data(engine, PROCESSED_FILE)
        embedding_load_result = load_embedding_cases(engine, EMBEDDING_CASES_FILE)
    except SQLAlchemyError as exc:
        raise SystemExit(f"Database reprocess load failed: {exc}") from exc

    print(
        {
            "raw_posts": len(raw_posts),
            "valid_posts": len(valid_posts),
            "invalid_posts": len(invalid_posts),
            **memory_result,
            **embedding_result,
            **reset_result,
            **load_result,
            **embedding_load_result,
        }
    )


if __name__ == "__main__":
    main()
