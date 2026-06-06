"""Collect marketplace data and upload parsed raw posts to the backend raw ingest API."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import requests

from crawlers.crawler import MARKETPLACE_PAGES, crawl_marketplace_pages


BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "data" / "raw"
PROCESSED_FILE = BASE_DIR / "data" / "processed" / "processed_posts.jsonl"
DEFAULT_API_URL = "http://localhost:8000/api/v1/raw-posts/bulk"


def load_parsed_raw_posts(raw_dir: Path) -> tuple[list[tuple[Path, dict[str, Any]]], list[tuple[Path, str]]]:
    posts: list[tuple[Path, dict[str, Any]]] = []
    skipped: list[tuple[Path, str]] = []

    for path in sorted(raw_dir.glob("parsed_*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            posts.append((path, raw))
        except json.JSONDecodeError as exc:
            skipped.append((path, f"invalid JSON: {exc}"))

    return posts, skipped


def build_raw_post_payload(path: Path, raw_post: dict[str, Any]) -> dict[str, Any]:
    source_url = str(raw_post.get("url") or raw_post.get("source_url") or "").strip()
    platform = str(raw_post.get("platform") or "unknown").strip()

    if not source_url:
        raise ValueError(f"{path} missing url/source_url")

    return {
        "platform": platform,
        "source_url": source_url,
        "title": raw_post.get("title"),
        "content": raw_post.get("content"),
        "price": raw_post.get("price"),
        "seller_id": raw_post.get("seller_id"),
        "raw_html": raw_post.get("raw_html"),
        "rendered_text": raw_post.get("rendered_text"),
        "crawled_at": raw_post.get("crawled_at"),
        "raw_payload": raw_post,
        "ingest_source": "pipeline",
        "source_file": path.name,
    }


def load_processed_posts(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"Processed JSONL file not found: {path}")

    posts: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            if not line.strip():
                continue
            try:
                post = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{line_number} invalid JSON: {exc}") from exc
            posts.append(post)

    if not posts:
        raise SystemExit(f"No processed posts found in {path}")

    return posts


def build_processed_post_payload(index: int, post: dict[str, Any], source_file: str) -> dict[str, Any]:
    source_url = str(post.get("url") or post.get("source_url") or "").strip()
    platform = str(post.get("platform") or "unknown").strip()

    if not source_url:
        raise ValueError(f"processed record {index} missing url/source_url")

    raw_payload = {
        "text_for_embedding": post.get("text_for_embedding"),
        "data_quality_score": post.get("data_quality_score"),
        "quality_flags": post.get("quality_flags", []),
        "risk_flags": post.get("risk_flags", []),
        "validation_reason": post.get("validation_reason"),
    }

    return {
        "platform": platform,
        "source_url": source_url,
        "title": post.get("title"),
        "content": post.get("content"),
        "price": post.get("price"),
        "seller_id": post.get("seller_id"),
        "raw_html": None,
        "rendered_text": post.get("rendered_text"),
        "crawled_at": post.get("crawled_at"),
        "raw_payload": raw_payload,
        "ingest_source": "pipeline_processed",
        "source_file": source_file,
    }


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def send_batch(api_url: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    response = requests.post(api_url, json={"items": items}, timeout=60)
    response.raise_for_status()
    return response.json()


def upload_raw_posts(raw_dir: Path, api_url: str, batch_size: int) -> tuple[int, int]:
    raw_posts, skipped_files = load_parsed_raw_posts(raw_dir)
    if not raw_posts:
        raise SystemExit(f"No parsed_*.json files found under {raw_dir}")

    payloads: list[dict[str, Any]] = []
    invalid_payloads: list[tuple[Path, str]] = []
    for path, raw_post in raw_posts:
        try:
            payloads.append(build_raw_post_payload(path, raw_post))
        except ValueError as exc:
            invalid_payloads.append((path, str(exc)))

    if not payloads:
        raise SystemExit(f"No uploadable raw posts found under {raw_dir}")

    total_created = 0
    total_updated = 0

    print(f"Loaded {len(payloads)} raw posts from {raw_dir}")
    skipped = [*skipped_files, *invalid_payloads]
    if skipped:
        print(f"Skipped {len(skipped)} raw files:")
        for path, reason in skipped[:10]:
            print(f"  - {path.name}: {reason}")
        if len(skipped) > 10:
            print(f"  ... and {len(skipped) - 10} more")

    print(f"Sending to {api_url}")
    for index, batch in enumerate(chunked(payloads, batch_size), start=1):
        result = send_batch(api_url, batch)
        total_created += int(result.get("created", 0))
        total_updated += int(result.get("updated", 0))
        print(
            f"[batch {index}] total={result.get('total', len(batch))} "
            f"created={result.get('created', 0)} updated={result.get('updated', 0)}"
        )

    print(f"Done. created={total_created} updated={total_updated}")
    return total_created, total_updated


def upload_processed_posts(processed_file: Path, api_url: str, batch_size: int) -> tuple[int, int]:
    processed_posts = load_processed_posts(processed_file)
    payloads: list[dict[str, Any]] = []
    invalid_payloads: list[tuple[int, str]] = []

    for index, post in enumerate(processed_posts, start=1):
        try:
            payloads.append(build_processed_post_payload(index, post, processed_file.name))
        except ValueError as exc:
            invalid_payloads.append((index, str(exc)))

    if not payloads:
        raise SystemExit(f"No uploadable processed posts found in {processed_file}")

    total_created = 0
    total_updated = 0

    print(f"Loaded {len(payloads)} processed posts from {processed_file}")
    if invalid_payloads:
        print(f"Skipped {len(invalid_payloads)} processed records:")
        for index, reason in invalid_payloads[:10]:
            print(f"  - line {index}: {reason}")
        if len(invalid_payloads) > 10:
            print(f"  ... and {len(invalid_payloads) - 10} more")

    print(f"Sending to {api_url}")
    for index, batch in enumerate(chunked(payloads, batch_size), start=1):
        result = send_batch(api_url, batch)
        total_created += int(result.get("created", 0))
        total_updated += int(result.get("updated", 0))
        print(
            f"[batch {index}] total={result.get('total', len(batch))} "
            f"created={result.get('created', 0)} updated={result.get('updated', 0)}"
        )

    print(f"Done. created={total_created} updated={total_updated}")
    return total_created, total_updated


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect marketplace raw data and upload parsed raw posts to the backend raw ingest API."
    )
    parser.add_argument(
        "--raw-dir",
        default=os.getenv("SAFE_TICKET_RAW_DIR", str(RAW_DIR)),
        help="Directory for parsed raw JSON artifacts.",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("SAFE_TICKET_RAW_POSTS_API_URL", DEFAULT_API_URL),
        help="Backend raw ingest endpoint URL.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Number of raw posts to upload per bulk request.",
    )
    parser.add_argument(
        "--total-links",
        type=int,
        default=100,
        help="Target total raw posts to collect across marketplaces.",
    )
    parser.add_argument(
        "--max-links",
        type=int,
        default=0,
        help="Max links per marketplace page. Overrides --total-links when set.",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Page load retry count for the crawler.",
    )
    parser.add_argument(
        "--scrolls",
        type=int,
        default=0,
        help="Number of additional search page scroll rounds.",
    )
    parser.add_argument(
        "--reset-data",
        action="store_true",
        help="Delete existing generated raw artifacts before crawling.",
    )
    parser.add_argument(
        "--upload-only",
        action="store_true",
        help="Skip crawling and upload existing parsed_*.json files from --raw-dir.",
    )
    parser.add_argument(
        "--processed-file",
        default=os.getenv("SAFE_TICKET_PROCESSED_FILE", ""),
        help="Upload cleaned processed_posts.jsonl records instead of parsed raw JSON files.",
    )
    args = parser.parse_args()

    raw_dir = Path(args.raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)

    if args.processed_file:
        upload_processed_posts(Path(args.processed_file), args.api_url, args.batch_size)
        return

    if args.reset_data and not args.upload_only:
        for item in raw_dir.iterdir():
            if item.is_file():
                item.unlink()
        print(f"Cleared existing raw artifacts under {raw_dir}")

    if not args.upload_only:
        max_links_per_platform = args.max_links
        if max_links_per_platform <= 0:
            max_links_per_platform = max(1, args.total_links // len(MARKETPLACE_PAGES))

        print("Collecting raw marketplace data...")
        raw_posts = crawl_marketplace_pages(
            raw_dir,
            max_links_per_platform=max_links_per_platform,
            retries=args.retries,
            scroll_rounds=args.scrolls,
        )
        print(f"Collected {len(raw_posts)} raw posts into {raw_dir}")

    upload_raw_posts(raw_dir, args.api_url, args.batch_size)


if __name__ == "__main__":
    main()
