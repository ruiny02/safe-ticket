"""Seed the pipeline fraud-memory tables with demo cases."""

from __future__ import annotations

import json
from pathlib import Path

from db.connection import get_engine
from db.models import init_db
from rag.embedding_export import save_embedding_cases_jsonl
from rag.repository import load_embedding_cases, search_similar_cases


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SEED_FILE = BASE_DIR / "seeds" / "seed_fraud_posts.json"
DEFAULT_OUTPUT_FILE = BASE_DIR / "data" / "generated_seed_embeddings.jsonl"


def load_seed_posts(seed_file: Path = DEFAULT_SEED_FILE) -> list[dict]:
    """Read demo fraud-memory posts from JSON."""
    with seed_file.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    if not isinstance(data, list):
        raise ValueError("seed fraud posts must be a JSON array")
    return data


def seed_memory(
    seed_file: Path = DEFAULT_SEED_FILE,
    output_file: Path = DEFAULT_OUTPUT_FILE,
) -> dict:
    """Create embeddings for seed posts and load them into the pipeline DB."""
    posts = load_seed_posts(seed_file)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    export_result = save_embedding_cases_jsonl(posts, output_file)

    engine = get_engine()
    init_db(engine)
    load_result = load_embedding_cases(engine, output_file)
    sample_matches = search_similar_cases(
        engine,
        "concert ticket bank transfer KakaoTalk safe payment refused",
        top_k=3,
    )

    return {
        "seed_file": str(seed_file),
        "embedding_file": str(output_file),
        **export_result,
        **load_result,
        "sample_matches": sample_matches,
    }


def main() -> None:
    """Run DB seeding from the command line."""
    print(json.dumps(seed_memory(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
