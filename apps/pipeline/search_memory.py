"""CLI helper for checking pipeline-owned fraud-memory similarity search."""

from __future__ import annotations

import json
import sys

from db.connection import get_engine
from rag.repository import search_similar_cases


def _read_int_arg(flag: str, default: int) -> int:
    if flag not in sys.argv:
        return default

    value_index = sys.argv.index(flag) + 1
    if value_index >= len(sys.argv):
        return default

    try:
        return int(sys.argv[value_index])
    except ValueError:
        return default


def _read_query() -> str:
    if "--query" in sys.argv:
        value_index = sys.argv.index("--query") + 1
        if value_index < len(sys.argv):
            return sys.argv[value_index]

    positional = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    return " ".join(positional)


def main() -> None:
    query = _read_query().strip()
    if not query:
        raise SystemExit("Usage: python apps/pipeline/search_memory.py --query \"ticket fraud text\" --top-k 5")

    top_k = _read_int_arg("--top-k", default=5)
    engine = get_engine()
    results = search_similar_cases(engine, query, top_k=top_k)
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
