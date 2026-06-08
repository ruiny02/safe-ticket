"""Prompt builders that keep retrieval context provider-neutral."""

from __future__ import annotations

import json

from app.services.rag.context import RAGContext
from app.services.rag.scoring import RAGScore


def build_scan_analysis_prompt(context: RAGContext, score: RAGScore) -> str:
    """Build a compact JSON-output prompt for scan report copy and highlights."""
    payload = {
        "task": "Safe Ticket report UI에 들어갈 중고거래 사기 위험 설명과 원문 하이라이트를 생성하세요.",
        "ui_slots": {
            "summary": "Dashboard/report hero와 판단 요약 카드에 들어가는 1-2문장 한국어 요약입니다.",
            "highlight_targets": "Top signals 표와 원문 빨간 하이라이트에 들어가는 원문 span입니다.",
            "recommended_actions": "Next actions 카드에 들어가는 구체적인 사용자 행동입니다.",
            "llm_reasoning": "RAG 유사 사례, 외부조회, rule, 사용자 context를 어떻게 해석했는지 설명하는 내부 근거 문장입니다.",
        },
        "constraints": [
            "점수는 이미 결정되어 있으므로 바꾸지 마세요.",
            "risk_level, risk_score, risk_points를 새로 만들거나 추정하지 마세요.",
            "highlight_targets는 반드시 원문 substring의 block_id/start/end/matched_text를 사용하세요.",
            "highlight_targets는 원문에서 실제로 위험 판단에 필요한 문구만 1-5개 고르세요.",
            "SellerContextReportCard는 별도 API가 담당하므로 판매자 프로필 정보를 지어내지 마세요.",
            "external_lookup_results가 신고 이력 없음이면 신고 이력이 있다고 말하지 마세요.",
            "불확실한 내용은 단정하지 말고 추가 확인이 필요하다고 표현하세요.",
            "summary와 recommended_actions는 사용자가 바로 읽을 수 있게 짧고 실무적으로 작성하세요.",
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
