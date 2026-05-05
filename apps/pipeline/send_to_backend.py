import json
import re
import time
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent
PROCESSED_FILE = BASE_DIR / "data" / "processed" / "processed_posts.jsonl"

API_URL = "http://localhost:8000/api/v1/scans"


def load_processed_posts(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"Processed file not found: {path}")

    posts = []
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            if line.strip():
                posts.append(json.loads(line))

    return posts


def parse_price_to_int(value) -> int:
    if value is None:
        return 0

    if isinstance(value, int):
        return value

    text = str(value)
    digits = re.sub(r"[^0-9]", "", text)

    if not digits:
        return 0

    return int(digits)


def split_content_blocks(text: str) -> list[dict]:
    text = (text or "").strip()

    if not text:
        return [
            {
                "block_id": "content_1",
                "text": "",
            }
        ]

    sentences = re.split(r"(?<=[.!?。！？])\s+|\n+", text)
    blocks = []

    for idx, sentence in enumerate(sentences, start=1):
        sentence = sentence.strip()
        if not sentence:
            continue

        blocks.append(
            {
                "block_id": f"content_{idx}",
                "text": sentence,
            }
        )

        if len(blocks) >= 20:
            break

    if not blocks:
        blocks.append(
            {
                "block_id": "content_1",
                "text": text[:2000],
            }
        )

    return blocks


def build_payload(post: dict) -> dict:
    backend_payload = post.get("backend_payload", {})

    page_url = backend_payload.get("url") or post.get("url", "")
    page_title = backend_payload.get("title") or post.get("title", "")
    raw_text = backend_payload.get("raw_text") or post.get("content", "")
    platform = backend_payload.get("platform") or post.get("platform", "unknown")
    price = parse_price_to_int(backend_payload.get("price") or post.get("price", 0))

    seller_id = post.get("seller_id") or ""
    seller_info = backend_payload.get("seller_info", {})

    if isinstance(seller_info, dict):
        seller_id = seller_info.get("seller_id") or seller_id

    seller_id = seller_id or "unknown_seller"

    return {
        "platform": platform,
        "page_url": page_url,
        "page_title": page_title,
        "price": price,
        "seller": {
            "seller_id": seller_id,
            "nickname": seller_id,
        },
        "content_blocks": split_content_blocks(raw_text),
    }


def send_scan(payload: dict) -> dict:
    response = requests.post(API_URL, json=payload, timeout=30)
    response.raise_for_status()
    return response.json()


def main() -> None:
    posts = load_processed_posts(PROCESSED_FILE)

    print(f"Loaded {len(posts)} processed posts.")
    print(f"Sending to {API_URL}")

    for idx, post in enumerate(posts, start=1):
        payload = build_payload(post)

        try:
            result = send_scan(payload)

            print(f"\n[{idx}] success")
            print(json.dumps(result, ensure_ascii=False, indent=2))

            time.sleep(0.5)

        except requests.exceptions.HTTPError as error:
            print(f"\n[{idx}] HTTP error")
            print(error)

            try:
                print(json.dumps(error.response.json(), ensure_ascii=False, indent=2))
            except Exception:
                print("Response:", error.response.text)

        except requests.exceptions.RequestException as error:
            print(f"\n[{idx}] Request error")
            print(error)


if __name__ == "__main__":
    main()