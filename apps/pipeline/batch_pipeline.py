"""Batch data pipeline entrypoint for crawling and loading historical cases."""

from pathlib import Path
import sys

from sqlalchemy.exc import SQLAlchemyError

from crawlers.crawler import crawl_marketplace_pages
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
from utils.quality_report import DataQualityReport

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DIR = BASE_DIR / "data" / "processed"
PROCESSED_FILE = PROCESSED_DIR / "processed_posts.jsonl"
MEMORY_CASES_FILE = PROCESSED_DIR / "memory_cases.jsonl"
EMBEDDING_CASES_FILE = PROCESSED_DIR / "memory_case_embeddings.jsonl"


def build_backend_payload(post: dict) -> dict:
    """Build the scan payload shape expected by the backend import helper."""
    raw_text = post.get("content") or post.get("rendered_text") or ""

    return {
        "raw_text": raw_text,
        "platform": post.get("platform", "unknown"),
        "url": post.get("url", ""),
        "title": post.get("title", ""),
        "price": post.get("price", ""),
        "price_int": post.get("price_int", 0),
        "seller_info": {
            "seller_id": post.get("seller_id", ""),
        },
        "extracted_entities": {
            "phone_number": post.get("phone_number", ""),
            "account_number": post.get("account_number", ""),
            "kakao_id": post.get("kakao_id", ""),
        },
        "rule_flags": post.get("risk_flags", []),
        "text_for_embedding": post.get("text_for_embedding", ""),
        "data_quality_score": post.get("data_quality_score", 0),
        "quality_flags": post.get("quality_flags", []),
    }


def remove_heavy_fields(post: dict) -> dict:
    """Remove large fields before saving processed JSONL artifacts."""
    cleaned = post.copy()
    cleaned.pop("raw_html", None)
    return cleaned


def _read_int_arg(flag: str, default: int) -> int:
    if flag not in sys.argv:
        return default

    flag_index = sys.argv.index(flag)
    value_index = flag_index + 1

    if value_index >= len(sys.argv):
        return default

    try:
        return int(sys.argv[value_index])
    except ValueError:
        return default


def run_pipeline(
    skip_db: bool = False,
    max_links_per_platform: int = 5,
    retries: int = 2,
    scroll_rounds: int = 0,
) -> None:
    """Run crawler, preprocessing, scoring, and optional database loading."""
    ensure_dir(RAW_DIR)
    ensure_dir(PROCESSED_DIR)

    print("[1/4] Crawling marketplace pages...")
    raw_posts = crawl_marketplace_pages(
        RAW_DIR,
        max_links_per_platform=max_links_per_platform,
        retries=retries,
        scroll_rounds=scroll_rounds,
    )
    print(f"  Crawled {len(raw_posts)} posts and saved raw artifacts.")

    print("[2/4] Cleaning raw data...")
    cleaned_posts = [clean_post(post) for post in raw_posts]
    print(f"  Cleaned {len(cleaned_posts)} posts.")

    print("[3/4] Validating, extracting entities, and scoring...")
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
    save_jsonl(PROCESSED_FILE, output_posts)
    memory_export_result = save_memory_cases_jsonl(output_posts, MEMORY_CASES_FILE)
    embedding_export_result = save_embedding_cases_jsonl(output_posts, EMBEDDING_CASES_FILE)

    print(f"  Extracted {len(valid_posts)} valid posts.")
    print(f"  Saved processed dataset to {PROCESSED_FILE}")
    print(
        "  Saved backend RAG import artifact to "
        f"{MEMORY_CASES_FILE} "
        f"({memory_export_result['memory_cases_written']} records)."
    )
    print(
        "  Saved embedding artifact to "
        f"{EMBEDDING_CASES_FILE} "
        f"({embedding_export_result['embedding_cases_written']} records)."
    )

    print("\n[Quality Report]")
    report = DataQualityReport()
    report.analyze(raw_posts, valid_posts, invalid_posts)
    report.print_report()

    if skip_db:
        print("\nSkipping database loading (--skip-db flag used).")
        return

    print("\n[4/4] Loading processed data into local pipeline table...")
    engine = get_engine()
    try:
        init_db(engine)
        load_result = load_processed_data(engine, PROCESSED_FILE)
        embedding_load_result = load_embedding_cases(engine, EMBEDDING_CASES_FILE)
    except SQLAlchemyError as exc:
        print("\nDatabase loading failed.")
        print("  Processed JSONL artifacts were already saved successfully.")
        print("  Start PostgreSQL or rerun with --skip-db if you only need files.")
        print(f"  Error: {exc}")
        return

    print(
        "  Data loaded: "
        f"{load_result['fraud_posts_inserted']} fraud_posts inserted, "
        f"{embedding_load_result['embedding_cases_inserted']} embedding cases inserted, "
        f"{embedding_load_result['embedding_chunks_inserted']} embedding chunks inserted."
    )


if __name__ == "__main__":
    skip_db = "--skip-db" in sys.argv
    max_links = _read_int_arg("--max-links", default=5)
    retries = _read_int_arg("--retries", default=2)
    scrolls = _read_int_arg("--scrolls", default=0)
    run_pipeline(
        skip_db=skip_db,
        max_links_per_platform=max_links,
        retries=retries,
        scroll_rounds=scrolls,
    )
