import json
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import FraudPost

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def load_processed_data(engine, processed_file: Path) -> None:
    if not processed_file.exists():
        logging.warning("Processed file not found: %s", processed_file)
        return

    inserted_count = 0
    skipped_count = 0

    with Session(engine) as session:
        with processed_file.open("r", encoding="utf-8") as file:
            for line in file:
                if not line.strip():
                    continue

                try:
                    data = json.loads(line)
                    url = data.get("url", "")

                    if not url:
                        skipped_count += 1
                        continue

                    existing = session.execute(
                        select(FraudPost).where(FraudPost.url == url)
                    ).scalar_one_or_none()

                    if existing:
                        skipped_count += 1
                        continue

                    post = FraudPost(
                        platform=data.get("platform", "unknown"),
                        url=url,
                        title=data.get("title", ""),
                        content=data.get("content", ""),
                        price=data.get("price", ""),
                        seller_id=data.get("seller_id", ""),
                        phone_number=data.get("phone_number", ""),
                        account_number=data.get("account_number", ""),
                        kakao_id=data.get("kakao_id", ""),
                        risk_flags=data.get("risk_flags", []),
                        quality_flags=data.get("quality_flags", []),
                        data_quality_score=data.get("data_quality_score", 0),
                        raw_html=data.get("raw_html", ""),
                        rendered_text=data.get("rendered_text", ""),
                        text_for_embedding=data.get("text_for_embedding", ""),
                        is_valid_post=str(data.get("is_valid_post", True)),
                        validation_reason=data.get("validation_reason", ""),
                    )

                    session.add(post)
                    inserted_count += 1

                except json.JSONDecodeError as exc:
                    logging.error("Failed to parse JSON line: %s", exc)
                    continue

                except Exception as exc:
                    logging.error("Error processing record: %s", exc)
                    continue

        session.commit()

    logging.info(
        "Data loading complete: %d inserted, %d skipped",
        inserted_count,
        skipped_count,
    )