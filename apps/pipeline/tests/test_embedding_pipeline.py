import json

from sqlalchemy import create_engine

from db.models import init_db
from rag.embedding_export import build_embedding_case_record, save_embedding_cases_jsonl
from rag.embeddings import cosine_similarity, embed_text
from rag.repository import load_embedding_cases, search_similar_cases


def build_post(title: str, content: str, url: str) -> dict:
    return {
        "platform": "joonggonara",
        "url": url,
        "title": title,
        "content": content,
        "price": "120,000",
        "price_int": 120000,
        "seller_id": "seller123",
        "phone_number": "",
        "account_number": "",
        "kakao_id": "",
        "risk_flags": ["safe_payment_evasion"],
        "quality_flags": ["has_title", "has_content"],
        "data_quality_score": 90,
        "text_for_embedding": f"title: {title} | content: {content}",
        "validation_reason": "valid",
    }


def test_embed_text_is_deterministic_and_normalized() -> None:
    first = embed_text("콘서트 티켓 선입금 카카오톡")
    second = embed_text("콘서트 티켓 선입금 카카오톡")

    assert first == second
    assert cosine_similarity(first, second) > 0.999


def test_build_embedding_case_record_adds_chunk_embeddings() -> None:
    post = build_post("콘서트 티켓 양도", "선입금 후 예매번호 전달", "https://example.com/1")
    record = build_embedding_case_record(post)

    assert record["embedding_metadata"]["embedding_model"] == "local-hashing-v1"
    assert record["embedding_metadata"]["embedding_dim"] == 128
    assert record["chunks"][0]["embedding"]
    assert len(record["chunks"][0]["embedding"]) == 128


def test_embedding_jsonl_load_and_similarity_search(tmp_path) -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    init_db(engine)

    suspicious_post = build_post(
        "콘서트 티켓 양도",
        "안전결제 불가 선입금 계좌이체만 가능합니다",
        "https://example.com/suspicious",
    )
    safe_post = build_post(
        "굿즈 판매",
        "직거래 가능하고 안전결제 가능합니다",
        "https://example.com/safe",
    )

    output_path = tmp_path / "memory_case_embeddings.jsonl"
    result = save_embedding_cases_jsonl([suspicious_post, safe_post], output_path)

    assert result["embedding_cases_written"] == 2
    assert len(output_path.read_text(encoding="utf-8").splitlines()) == 2

    load_result = load_embedding_cases(engine, output_path)
    assert load_result["embedding_cases_inserted"] == 2
    assert load_result["embedding_chunks_inserted"] >= 2

    matches = search_similar_cases(engine, "콘서트 티켓 선입금 계좌이체", top_k=1)
    assert matches
    assert matches[0]["case_id"] == json.loads(output_path.read_text(encoding="utf-8").splitlines()[0])["case"]["case_id"]
