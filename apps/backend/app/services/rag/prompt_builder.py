"""Prompt builders that keep retrieval context provider-neutral."""

from __future__ import annotations

import json

from app.services.rag.context import RAGContext
from app.services.rag.scoring import RAGScore


def build_scan_analysis_prompt(context: RAGContext, score: RAGScore) -> str:
    """Build a compact JSON-output prompt for scan report copy and highlights."""
    payload = {
        "task": "중고거래 사기 위험 설명과 원문 하이라이트를 생성하세요.",
        "constraints": [
            "점수는 이미 결정되어 있으므로 바꾸지 마세요.",
            "highlight_targets는 반드시 원문 substring의 block_id/start/end/matched_text를 사용하세요.",
            "불확실한 내용은 단정하지 말고 추가 확인이 필요하다고 표현하세요.",
            "응답은 JSON object만 반환하세요.",
        ],
        "expected_schema": {
            "summary": "string",
            "llm_reasoning": "string",
            "highlight_targets": [
                {
                    "block_id": "string",
                    "start": "number",
                    "end": "number",
                    "matched_text": "string",
                    "reason_code": "string",
                    "reason": "string",
                }
            ],
            "recommended_actions": [
                {
                    "action": "string",
                    "description": "string",
                }
            ],
        },
        "score": {
            "risk_points": score.risk_points,
            "risk_score": score.risk_score,
            "risk_level": score.risk_level,
            "breakdown": [item.model_dump(mode="json") for item in score.breakdown],
        },
        "user_context": context.user_context.model_dump(mode="json"),
        "external_lookup_results": [
            result.model_dump(mode="json") for result in context.external_lookup_results
        ],
        "savings_account_signals": [
            signal.model_dump(mode="json") for signal in context.savings_account_signals
        ],
        "similar_cases_top3": [
            {
                "case_id": item.case_id,
                "score": round(item.score, 6),
                "summary": item.summary,
                "matched_chunk": item.matched_chunk,
                "risk_level": item.risk_level,
                "risk_flags": item.risk_flags,
            }
            for item in context.similar_cases_top3
        ],
        "content_blocks": [
            block.model_dump(mode="json") for block in context.scan_payload.content_blocks
        ],
    }
    return json.dumps(payload, ensure_ascii=False)
