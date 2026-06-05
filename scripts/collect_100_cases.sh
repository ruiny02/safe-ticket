#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/3] Checking Docker Compose services..."
docker compose ps

echo
echo "[2/3] Resetting old pipeline data, then collecting 100 raw posts..."
docker compose exec -T -w /app/apps/pipeline pipeline \
  python batch_pipeline.py \
    --reset-data \
    --reset-db \
    --total-links 100 \
    --scrolls 12 \
    --retries 2

echo
echo "[3/3] Done. Generated files:"
echo "  - apps/pipeline/data/raw/raw_posts.jsonl"
echo "  - apps/pipeline/data/processed/text_preprocessed_posts.jsonl"
echo "  - apps/pipeline/data/processed/processed_posts.jsonl"
echo "  - apps/pipeline/data/processed/memory_cases.jsonl"
echo "  - apps/pipeline/data/embeddings/memory_case_embeddings.jsonl"
