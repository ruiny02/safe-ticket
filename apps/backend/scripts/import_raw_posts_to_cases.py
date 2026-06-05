"""CLI helper for importing raw_posts into backend RAG memory tables."""

from __future__ import annotations

import argparse

from app.services.raw_post_importer import import_raw_posts_to_cases


def main() -> None:
    parser = argparse.ArgumentParser(description="Import raw_posts into cases and related RAG tables.")
    parser.add_argument("--limit", type=int, default=None, help="Optional max raw_posts to import.")
    args = parser.parse_args()

    result = import_raw_posts_to_cases(limit=args.limit)
    print(result.model_dump())


if __name__ == "__main__":
    main()
