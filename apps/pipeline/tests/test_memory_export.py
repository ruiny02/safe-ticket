import json

from memory_export import build_case_id, build_memory_case_record, hash_entity_value, save_memory_cases_jsonl


def build_processed_post() -> dict:
    return {
        "platform": "joonggonara",
        "url": "https://example.com/product/123",
        "title": "콘서트 티켓 양도",
        "content": "안전결제 불가, 계좌이체만 가능합니다. 카톡 ticket123",
        "price": "120,000",
        "seller_id": "seller123",
        "phone_number": "010-1234-5678",
        "account_number": "카카오뱅크1234-56-7890",
        "kakao_id": "ticket123",
        "risk_flags": ["safe_payment_evasion", "direct_deposit_request"],
        "quality_flags": ["has_title", "has_content"],
        "data_quality_score": 90,
        "rendered_text": "콘서트 티켓 양도 안전결제 불가",
        "text_for_embedding": "title: 콘서트 티켓 양도 | risk_flags: safe_payment_evasion",
        "is_valid_post": True,
        "validation_reason": "valid",
    }


def test_build_memory_case_record_matches_backend_import_shape() -> None:
    post = build_processed_post()
    record = build_memory_case_record(post)

    assert record["case"] == {
        "case_id": build_case_id(post),
        "source_type": "marketplace_crawl",
        "source_url": post["url"],
        "title": post["title"],
        "body": "콘서트 티켓 양도\n\n안전결제 불가, 계좌이체만 가능합니다. 카톡 ticket123\n\n콘서트 티켓 양도 안전결제 불가",
        "label": "fraud_signal",
        "summary": "콘서트 티켓 양도 / signals: safe_payment_evasion, direct_deposit_request",
        "platform_hint": "joonggonara",
    }
    assert record["chunks"] == [
        {
            "chunk_order": 1,
            "chunk_text": "title: 콘서트 티켓 양도 | risk_flags: safe_payment_evasion",
        }
    ]
    assert {entity["entity_type"] for entity in record["entities"]} == {
        "phone",
        "account",
        "messenger",
        "seller",
    }
    assert record["seller_observation"]["phone_hash"] == hash_entity_value("010-1234-5678")
    assert record["pipeline_metadata"]["data_quality_score"] == 90


def test_save_memory_cases_jsonl_deduplicates_by_case_id(tmp_path) -> None:
    output_path = tmp_path / "memory_cases.jsonl"
    post = build_processed_post()

    result = save_memory_cases_jsonl([post, post], output_path)

    assert result == {
        "memory_cases_written": 1,
        "memory_cases_skipped": 1,
    }

    lines = output_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["case"]["case_id"] == build_case_id(post)
