"""Backfill Google Gemini embeddings into server-owned case_chunks rows.

This script is intentionally resumable: it only updates rows where
case_chunks.embedding is NULL, so it can be stopped and run again safely.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import time
from dataclasses import dataclass
from typing import Any

import requests
from dotenv import load_dotenv
from sqlalchemy import create_engine, text


DEFAULT_MODEL = "gemini-embedding-1"
DEFAULT_OUTPUT_DIM = 768
DEFAULT_TASK_TYPE = "RETRIEVAL_DOCUMENT"
EMBEDDING_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"


@dataclass(frozen=True)
class ChunkRow:
    """One chunk that still needs an embedding."""

    chunk_id: int
    case_id: str
    title: str | None
    summary: str | None
    risk_level: str | None
    risk_flags_json: Any
    chunk_text: str


def parse_args() -> argparse.Namespace:
    """Parse CLI options for safe, resumable embedding backfills."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="SQLAlchemy database URL. Example: postgresql+psycopg://postgres:postgres@127.0.0.1:15432/safe_ticket",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"),
        help="Google AI Studio API key. Defaults to GEMINI_API_KEY or GOOGLE_API_KEY.",
    )
    parser.add_argument("--model", default=os.getenv("GEMINI_EMBEDDING_MODEL", DEFAULT_MODEL))
    parser.add_argument("--output-dim", type=int, default=int(os.getenv("GEMINI_EMBEDDING_DIM", DEFAULT_OUTPUT_DIM)))
    parser.add_argument("--task-type", default=DEFAULT_TASK_TYPE)
    parser.add_argument("--limit", type=int, default=25, help="Maximum rows to process in this run.")
    parser.add_argument("--batch-size", type=int, default=25, help="Rows fetched from DB at once.")
    parser.add_argument(
        "--requests-per-minute",
        type=float,
        default=100.0,
        help="Throttle Google API calls. Conservative default avoids free-tier rate-limit surprises.",
    )
    parser.add_argument("--max-retries", type=int, default=6)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Recompute and replace existing embeddings instead of only filling NULL rows.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Fetch rows and call no API/update no DB.")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Required for write runs so accidental production updates are harder.",
    )
    return parser.parse_args()


def main() -> None:
    """Run one bounded backfill pass."""
    load_dotenv()
    args = parse_args()
    _validate_args(args)

    engine = create_engine(args.database_url, future=True)
    pending_total = count_target_chunks(engine, overwrite=args.overwrite)
    target_description = "all chunks" if args.overwrite else "chunks without embedding"
    print(f"Target {target_description}: {pending_total}")

    rows = fetch_target_chunks(engine, limit=min(args.limit, args.batch_size), overwrite=args.overwrite)
    if not rows:
        print("No chunks need embeddings.")
        return

    if args.dry_run:
        print(f"Dry run: would process {len(rows)} chunks.")
        for row in rows[:5]:
            print(f"- chunk_id={row.chunk_id} case_id={row.case_id} text_len={len(row.chunk_text)}")
        return

    processed = 0
    interval_seconds = 60.0 / max(args.requests_per_minute, 1.0)

    while rows and processed < args.limit:
        for row in rows:
            if processed >= args.limit:
                break

            embedding = embed_chunk_with_retry(
                api_key=args.api_key,
                model=args.model,
                task_type=args.task_type,
                output_dim=args.output_dim,
                row=row,
                max_retries=args.max_retries,
            )
            update_chunk_embedding(engine, row.chunk_id, embedding)
            processed += 1
            print(
                f"Updated chunk_id={row.chunk_id} case_id={row.case_id} "
                f"dim={len(embedding)} processed={processed}/{args.limit}"
            )
            time.sleep(interval_seconds)

        remaining_limit = args.limit - processed
        rows = fetch_target_chunks(engine, limit=min(args.batch_size, remaining_limit), overwrite=args.overwrite)

    print(f"Backfill complete for this run. Updated {processed} chunks.")
    print(f"Remaining chunks without embedding: {count_target_chunks(engine, overwrite=False)}")


def _validate_args(args: argparse.Namespace) -> None:
    """Fail early for unsafe or incomplete write attempts."""
    if not args.database_url:
        raise SystemExit("DATABASE_URL is required.")
    if not args.dry_run and not args.api_key:
        raise SystemExit("GEMINI_API_KEY or GOOGLE_API_KEY is required for write runs.")
    if not args.dry_run and not args.yes:
        raise SystemExit("Write runs require --yes. Start with --dry-run first.")
    if args.output_dim < 128 or args.output_dim > 3072:
        raise SystemExit("--output-dim must be between 128 and 3072 for Gemini embedding models.")
    if args.limit < 1:
        raise SystemExit("--limit must be at least 1.")
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be at least 1.")


def count_target_chunks(engine, *, overwrite: bool) -> int:
    """Return how many server chunks match the requested backfill mode."""
    where_clause = "TRUE" if overwrite else "embedding IS NULL"
    with engine.connect() as connection:
        return int(
            connection.execute(
                text(f"SELECT COUNT(*) FROM case_chunks WHERE {where_clause}")
            ).scalar_one()
        )


def fetch_target_chunks(engine, limit: int, *, overwrite: bool) -> list[ChunkRow]:
    """Fetch the next chunks in deterministic order for the selected mode."""
    if limit <= 0:
        return []

    where_clause = "TRUE" if overwrite else "cc.embedding IS NULL"
    query = text(
        f"""
        SELECT
            cc.chunk_id,
            cc.case_id,
            c.title,
            c.summary,
            c.risk_level,
            c.risk_flags_json,
            cc.chunk_text
        FROM case_chunks cc
        JOIN cases c ON c.case_id = cc.case_id
        WHERE {where_clause}
        ORDER BY cc.case_id, cc.chunk_order, cc.chunk_id
        LIMIT :limit
        """
    )

    with engine.connect() as connection:
        rows = connection.execute(query, {"limit": limit}).mappings().all()

    return [
        ChunkRow(
            chunk_id=int(row["chunk_id"]),
            case_id=str(row["case_id"]),
            title=row["title"],
            summary=row["summary"],
            risk_level=row["risk_level"],
            risk_flags_json=row["risk_flags_json"],
            chunk_text=str(row["chunk_text"]),
        )
        for row in rows
    ]


def embed_chunk_with_retry(
    *,
    api_key: str,
    model: str,
    task_type: str,
    output_dim: int,
    row: ChunkRow,
    max_retries: int,
) -> list[float]:
    """Embed one chunk, backing off on transient API failures."""
    for attempt in range(max_retries + 1):
        try:
            return embed_chunk(
                api_key=api_key,
                model=model,
                task_type=task_type,
                output_dim=output_dim,
                row=row,
            )
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code not in {429, 500, 502, 503, 504} or attempt >= max_retries:
                raise
            sleep_seconds = min(90.0, (2**attempt) + random.uniform(0, 1.5))
            print(f"Google API returned {status_code}; retrying in {sleep_seconds:.1f}s")
            time.sleep(sleep_seconds)
        except requests.RequestException:
            if attempt >= max_retries:
                raise
            sleep_seconds = min(60.0, (2**attempt) + random.uniform(0, 1.0))
            print(f"Network error; retrying in {sleep_seconds:.1f}s")
            time.sleep(sleep_seconds)

    raise RuntimeError("unreachable retry state")


def embed_chunk(
    *,
    api_key: str,
    model: str,
    task_type: str,
    output_dim: int,
    row: ChunkRow,
) -> list[float]:
    """Call Google Gemini embedContent for one document chunk."""
    endpoint = EMBEDDING_ENDPOINT.format(model=model)
    response = requests.post(
        endpoint,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        json={
            "taskType": task_type,
            "output_dimensionality": output_dim,
            "content": {
                "parts": [
                    {
                        "text": build_document_text(row),
                    }
                ]
            },
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    values = extract_embedding_values(payload)

    # Google docs note that gemini-embedding-001 non-3072 outputs should be normalized.
    if output_dim != 3072:
        values = normalize(values)

    return values


def build_document_text(row: ChunkRow) -> str:
    """Format chunk text as a retrieval document with case-level risk context."""
    parts = [
        f"case_id: {row.case_id}",
        f"title: {_clean_text(row.title) or 'none'}",
        f"summary: {_clean_text(row.summary) or 'none'}",
        f"risk_level: {_clean_text(row.risk_level) or 'unknown'}",
        f"risk_flags: {_format_risk_flags(row.risk_flags_json)}",
        f"text: {row.chunk_text.strip()}",
    ]
    return "\n".join(parts)


def _clean_text(value: str | None) -> str:
    """Normalize optional DB text for embedding input."""
    return " ".join(str(value or "").split())


def _format_risk_flags(value: Any) -> str:
    """Format JSON risk flags compactly for embedding input."""
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if str(item).strip()) or "none"
    if isinstance(value, dict):
        return ", ".join(f"{key}={item}" for key, item in value.items()) or "none"
    return _clean_text(str(value)) or "none"


def extract_embedding_values(payload: dict[str, Any]) -> list[float]:
    """Extract embedding values from Gemini REST responses."""
    embedding = payload.get("embedding")
    if isinstance(embedding, dict) and isinstance(embedding.get("values"), list):
        return [float(value) for value in embedding["values"]]

    embeddings = payload.get("embeddings")
    if isinstance(embeddings, list) and embeddings:
        first = embeddings[0]
        if isinstance(first, dict) and isinstance(first.get("values"), list):
            return [float(value) for value in first["values"]]

    raise ValueError("Gemini response did not include embedding values.")


def normalize(values: list[float]) -> list[float]:
    """Return a unit-length vector for cosine search."""
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude == 0:
        return values
    return [value / magnitude for value in values]


def update_chunk_embedding(engine, chunk_id: int, embedding: list[float]) -> None:
    """Persist the embedding into pgvector."""
    vector_literal = "[" + ",".join(f"{value:.10f}" for value in embedding) + "]"
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE case_chunks
                SET embedding = CAST(:embedding AS vector)
                WHERE chunk_id = :chunk_id
                """
            ),
            {
                "embedding": vector_literal,
                "chunk_id": chunk_id,
            },
        )


if __name__ == "__main__":
    main()
