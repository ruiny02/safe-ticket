"""Export embedding-enriched fraud memory artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from memory_export import build_memory_case_record
from rag.embeddings import DEFAULT_EMBEDDING_DIM, DEFAULT_EMBEDDING_MODEL, embed_text


def save_embedding_cases_jsonl(
    posts: Iterable[dict],
    output_path: Path,
    dim: int = DEFAULT_EMBEDDING_DIM,
    model_name: str = DEFAULT_EMBEDDING_MODEL,
) -> dict[str, int]:
    """Write unique memory-case records with chunk embeddings."""
    seen_case_ids = set()
    written = 0
    skipped = 0

    with output_path.open("w", encoding="utf-8") as handle:
        for post in posts:
            record = build_embedding_case_record(post, dim=dim, model_name=model_name)
            case_id = record["case"]["case_id"]

            if case_id in seen_case_ids:
                skipped += 1
                continue

            seen_case_ids.add(case_id)
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1

    return {
        "embedding_cases_written": written,
        "embedding_cases_skipped": skipped,
    }


def build_embedding_case_record(
    post: dict,
    dim: int = DEFAULT_EMBEDDING_DIM,
    model_name: str = DEFAULT_EMBEDDING_MODEL,
) -> dict:
    """Return the natural-language memory record plus chunk embeddings."""
    record = build_memory_case_record(post)
    record["embedding_metadata"] = {
        "embedding_model": model_name,
        "embedding_dim": dim,
        "embedding_scope": "chunk_text",
    }

    for chunk in record["chunks"]:
        chunk["embedding"] = embed_text(chunk["chunk_text"], dim=dim)

    return record
