"""Store and retrieve pipeline-owned embedding cases."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import EmbeddingCase, EmbeddingChunk
from rag.embeddings import DEFAULT_EMBEDDING_DIM, cosine_similarity, embed_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def load_embedding_cases(engine, embedding_file: Path) -> dict[str, int]:
    """Load embedding JSONL into pipeline-owned embedding tables."""
    if not embedding_file.exists():
        logging.warning("Embedding file not found: %s", embedding_file)
        return {
            "embedding_cases_inserted": 0,
            "embedding_cases_skipped": 0,
            "embedding_chunks_inserted": 0,
        }

    cases_inserted = 0
    cases_skipped = 0
    chunks_inserted = 0

    with Session(engine) as session:
        with embedding_file.open("r", encoding="utf-8") as file:
            for line in file:
                if not line.strip():
                    continue

                try:
                    record = json.loads(line)
                    case_data = record["case"]
                    case_id = case_data["case_id"]

                    if session.get(EmbeddingCase, case_id):
                        cases_skipped += 1
                        continue

                    metadata = record.get("embedding_metadata", {})
                    case = EmbeddingCase(
                        case_id=case_id,
                        source_type=case_data.get("source_type", "marketplace_crawl"),
                        source_url=case_data.get("source_url", ""),
                        title=case_data.get("title", ""),
                        body=case_data.get("body", ""),
                        label=case_data.get("label", ""),
                        summary=case_data.get("summary", ""),
                        platform_hint=case_data.get("platform_hint", "unknown"),
                        entities_json=record.get("entities", []),
                        seller_observation_json=record.get("seller_observation", {}),
                        pipeline_metadata_json=record.get("pipeline_metadata", {}),
                        embedding_model=metadata.get("embedding_model", ""),
                        embedding_dim=metadata.get("embedding_dim", DEFAULT_EMBEDDING_DIM),
                    )
                    session.add(case)
                    session.flush()
                    cases_inserted += 1

                    for chunk in record.get("chunks", []):
                        session.add(
                            EmbeddingChunk(
                                case_id=case_id,
                                chunk_order=chunk.get("chunk_order", 0),
                                chunk_text=chunk.get("chunk_text", ""),
                                embedding=chunk.get("embedding", []),
                            )
                        )
                        chunks_inserted += 1

                except (KeyError, json.JSONDecodeError, TypeError) as exc:
                    logging.error("Failed to load embedding record: %s", exc)
                    continue

        session.commit()

    result = {
        "embedding_cases_inserted": cases_inserted,
        "embedding_cases_skipped": cases_skipped,
        "embedding_chunks_inserted": chunks_inserted,
    }
    logging.info(
        "Embedding load complete: %d cases inserted, %d cases skipped, %d chunks inserted",
        cases_inserted,
        cases_skipped,
        chunks_inserted,
    )
    return result


def search_similar_cases(
    engine,
    query_text: str,
    top_k: int = 5,
    dim: int = DEFAULT_EMBEDDING_DIM,
) -> list[dict]:
    """Return top-k similar cases using exact cosine search.

    This exact search works for small/medium local datasets and is reliable
    across PostgreSQL and SQLite. pgvector storage is still used when available;
    approximate indexes can be added later after collection volume grows.
    """
    query_embedding = embed_text(query_text, dim=dim)
    matches = []

    with Session(engine) as session:
        rows = session.execute(
            select(EmbeddingChunk, EmbeddingCase)
            .join(EmbeddingCase, EmbeddingChunk.case_id == EmbeddingCase.case_id)
        ).all()

        for chunk, case in rows:
            chunk_embedding = [] if chunk.embedding is None else list(chunk.embedding)
            score = float(cosine_similarity(query_embedding, chunk_embedding))
            matches.append(
                {
                    "case_id": case.case_id,
                    "chunk_order": chunk.chunk_order,
                    "score": round(score, 6),
                    "summary": case.summary or case.title or "",
                    "source_url": case.source_url,
                    "platform_hint": case.platform_hint,
                    "matched_text": chunk.chunk_text[:300],
                }
            )

    matches.sort(key=lambda item: item["score"], reverse=True)
    return matches[:top_k]
