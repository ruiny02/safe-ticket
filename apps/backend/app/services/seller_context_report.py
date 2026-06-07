"""Generate seller context reports grounded in scan results and profile data."""

from __future__ import annotations

import json
import re

import httpx
from pydantic import ValidationError

from app.core.config import get_settings
from app.schemas.scan import PipelineOutboundPayload, ScanResultResponse
from app.schemas.seller import SellerContextReportResponse, SellerProfileSnapshot
from app.services.gemini_chat import GEMINI_GENERATE_CONTENT_BASE_URL


class SellerContextReportError(RuntimeError):
    """Raised when Gemini cannot produce a valid seller context report."""


class SellerContextReportService:
    """Build prompts and parse Gemini's seller context report JSON."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = api_key if api_key is not None else settings.gemini_api_key
        self.model = model if model is not None else settings.gemini_analysis_model
        self.timeout_seconds = (
            timeout_seconds if timeout_seconds is not None else settings.gemini_api_timeout_seconds
        )

    def create_report(
        self,
        *,
        scan_result: ScanResultResponse,
        outbound_payload: PipelineOutboundPayload,
        profile: SellerProfileSnapshot,
    ) -> SellerContextReportResponse:
        """Call Gemini and validate the seller report JSON response."""
        if not self.api_key:
            raise SellerContextReportError("GEMINI_API_KEY is not configured.")

        request_url = f"{GEMINI_GENERATE_CONTENT_BASE_URL}/{self.model}:generateContent"
        request_body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": self._build_prompt(scan_result, outbound_payload, profile)}],
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 1800,
                "responseMimeType": "application/json",
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(request_url, headers=headers, json=request_body)
                response.raise_for_status()
                response_body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SellerContextReportError(f"Gemini seller report request failed: {exc}") from exc

        return self._parse_report(response_body, scan_result=scan_result, profile=profile)

    def create_backend_fallback(
        self,
        *,
        scan_result: ScanResultResponse,
        outbound_payload: PipelineOutboundPayload,
        profile: SellerProfileSnapshot,
    ) -> SellerContextReportResponse:
        """Create a deterministic report when Gemini is unavailable."""
        risk_score = scan_result.risk_score or 0
        profile_score = _profile_score(profile)
        pattern_consistency = _estimate_pattern_consistency(outbound_payload, profile)
        combined_score = _combined_context_score(risk_score, profile_score, pattern_consistency)
        risk_signals = [
            f"{item.matched_text}: {item.reason}" for item in scan_result.evidence_items[:4]
        ] or list(scan_result.risk_tags[:4])

        return SellerContextReportResponse(
            scan_id=scan_result.scan_id,
            profile_url=profile.profile_url,
            seller_name=profile.seller_name,
            seller_context_level=_context_level(combined_score),
            seller_context_score=round(combined_score, 3),
            pattern_consistency=pattern_consistency,
            summary=(
                "Seller profile signals were compared with the current scan result. "
                "Use the current listing evidence as the stronger safety signal when profile trust and listing risk conflict."
            ),
            positive_profile_signals=_positive_profile_signals(profile),
            current_listing_risk_signals=risk_signals,
            pattern_shift_explanation=_pattern_explanation(pattern_consistency),
            recommendation=_recommendation(combined_score),
            profile_snapshot=profile,
            source="backend",
            model=None,
        )

    def _build_prompt(
        self,
        scan_result: ScanResultResponse,
        outbound_payload: PipelineOutboundPayload,
        profile: SellerProfileSnapshot,
    ) -> str:
        """Build a strict JSON-only prompt grounded in backend scan evidence."""
        listing_text = "\n".join(
            f"- {block.block_id}: {block.text}" for block in outbound_payload.content_blocks[:8]
        )
        evidence = "\n".join(
            f"- {item.matched_text}: {item.reason_code} / {item.reason}"
            for item in scan_result.evidence_items[:8]
        )
        similar_cases = "\n".join(
            f"- {case.case_id}: score={case.score}, summary={case.summary}"
            for case in scan_result.similar_cases[:5]
        )

        context = {
            "current_listing": {
                "platform": outbound_payload.platform,
                "page_url": str(outbound_payload.page_url),
                "page_title": outbound_payload.page_title,
                "price": outbound_payload.price,
                "seller": outbound_payload.seller.model_dump(mode="json"),
                "content_blocks": listing_text,
            },
            "scan_result": {
                "risk_level": scan_result.risk_level,
                "risk_score": scan_result.risk_score,
                "summary": scan_result.summary,
                "risk_tags": scan_result.risk_tags,
                "evidence_items": evidence,
                "similar_cases": similar_cases,
            },
            "seller_profile": profile.model_dump(mode="json"),
        }

        return (
            "You are Safe Ticket's second-hand transaction safety analyst.\n"
            "Analyze whether this seller profile context changes how a user should interpret the CURRENT listing risk.\n"
            "Do not decide whether the seller is definitely fraudulent. Do not make accusations.\n"
            "Compare the seller's public historical pattern with the current listing and backend scan evidence.\n"
            "If the profile looks trustworthy but the current listing has high-risk evidence, clearly explain that profile trust does not remove current transaction risk.\n"
            "If the current listing category or behavior differs from recent seller products, explain the pattern shift.\n"
            "Use the backend scan risk score and evidence as strong signals, but explain them through concrete evidence.\n"
            "Answer in Korean.\n"
            "Return JSON only with exactly these fields:\n"
            "{"
            "\"seller_context_level\":\"trusted|caution|high_risk|unknown\","
            "\"seller_context_score\":0.0,"
            "\"pattern_consistency\":\"consistent|mixed|inconsistent|unknown\","
            "\"summary\":\"...\","
            "\"positive_profile_signals\":[\"...\"],"
            "\"current_listing_risk_signals\":[\"...\"],"
            "\"pattern_shift_explanation\":\"...\","
            "\"recommendation\":\"...\""
            "}\n\n"
            f"Grounding data:\n{json.dumps(context, ensure_ascii=False)}"
        )

    def _parse_report(
        self,
        response_body: object,
        *,
        scan_result: ScanResultResponse,
        profile: SellerProfileSnapshot,
    ) -> SellerContextReportResponse:
        """Extract and validate Gemini's JSON report."""
        text = _extract_gemini_text(response_body)
        parsed = _parse_json_object(text)
        parsed.update(
            {
                "scan_id": scan_result.scan_id,
                "profile_url": profile.profile_url,
                "seller_name": profile.seller_name,
                "profile_snapshot": profile.model_dump(mode="json"),
                "source": "gemini",
                "model": self.model,
            }
        )
        try:
            return SellerContextReportResponse.model_validate(parsed)
        except ValidationError as exc:
            raise SellerContextReportError("Gemini returned invalid seller report JSON.") from exc


def _extract_gemini_text(response_body: object) -> str:
    """Extract text parts from a Gemini generateContent response."""
    if not isinstance(response_body, dict):
        raise SellerContextReportError("Gemini returned a non-object response.")
    candidates = response_body.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise SellerContextReportError("Gemini returned no candidates.")
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    if not isinstance(content, dict):
        raise SellerContextReportError("Gemini candidate has no content.")
    parts = content.get("parts")
    if not isinstance(parts, list):
        raise SellerContextReportError("Gemini content has no parts.")
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise SellerContextReportError("Gemini returned an empty seller report.")
    return text


def _parse_json_object(text: str) -> dict:
    """Parse JSON even if the model wrapped it in a Markdown code fence."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise SellerContextReportError("Gemini seller report was not valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise SellerContextReportError("Gemini seller report JSON must be an object.")
    return parsed


def _profile_score(profile: SellerProfileSnapshot) -> float:
    """Estimate seller profile strength before considering the current listing."""
    score = 0.35
    if profile.response_rate_percent is not None:
        score += min(profile.response_rate_percent / 100, 1.0) * 0.2
    if profile.trust_index is not None:
        score += min(profile.trust_index / 1000, 1.0) * 0.2
    if profile.review_count:
        score += min(profile.review_count / 20, 1.0) * 0.15
    if profile.safe_payment_count:
        score += min(profile.safe_payment_count / 10, 1.0) * 0.1
    if profile.total_products:
        score += min(profile.total_products / 100, 1.0) * 0.1
    return min(score, 1.0)


def _estimate_pattern_consistency(
    outbound_payload: PipelineOutboundPayload,
    profile: SellerProfileSnapshot,
) -> str:
    """Use simple token overlap to compare current title with recent seller products."""
    if not profile.recent_product_titles:
        return "unknown"
    title_tokens = _tokens(outbound_payload.page_title)
    if not title_tokens:
        return "unknown"
    overlaps = [
        len(title_tokens & _tokens(title)) / max(len(title_tokens), 1)
        for title in profile.recent_product_titles
    ]
    best = max(overlaps or [0])
    if best >= 0.45:
        return "consistent"
    if best >= 0.2:
        return "mixed"
    return "inconsistent"


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[0-9A-Za-z가-힣]{2,}", (text or "").lower()))


def _combined_context_score(risk_score: float, profile_score: float, pattern_consistency: str) -> float:
    """Higher score means higher caution in the seller context report."""
    pattern_penalty = {"consistent": 0.0, "mixed": 0.08, "inconsistent": 0.18, "unknown": 0.05}[pattern_consistency]
    return min(1.0, max(0.0, (risk_score * 0.75) + ((1 - profile_score) * 0.2) + pattern_penalty))


def _context_level(score: float) -> str:
    if score >= 0.72:
        return "high_risk"
    if score >= 0.38:
        return "caution"
    return "trusted"


def _positive_profile_signals(profile: SellerProfileSnapshot) -> list[str]:
    signals: list[str] = []
    if profile.response_rate_percent is not None:
        signals.append(f"응답률 {profile.response_rate_percent}%")
    if profile.trust_index is not None:
        signals.append(f"신뢰지수 {profile.trust_index}")
    if profile.total_products is not None:
        signals.append(f"판매상품 {profile.total_products}개")
    if profile.safe_payment_count is not None:
        signals.append(f"안심결제 {profile.safe_payment_count}건")
    if profile.review_count is not None:
        signals.append(f"거래후기 {profile.review_count}건")
    return signals


def _pattern_explanation(pattern_consistency: str) -> str:
    if pattern_consistency == "consistent":
        return "현재 글은 판매자의 최근 공개 판매 제목들과 일부 유사한 패턴을 보입니다."
    if pattern_consistency == "mixed":
        return "현재 글은 판매자의 최근 공개 판매 패턴과 일부만 겹치므로 추가 확인이 필요합니다."
    if pattern_consistency == "inconsistent":
        return "현재 글은 판매자의 최근 공개 판매 제목들과 뚜렷하게 다른 패턴일 수 있습니다."
    return "판매자의 최근 판매 패턴을 충분히 추정할 공개 제목이 부족합니다."


def _recommendation(score: float) -> str:
    if score >= 0.72:
        return "현재 글의 위험 근거가 강하므로 안전결제 또는 직거래 외 방식은 피하는 것이 좋습니다."
    if score >= 0.38:
        return "판매자 프로필이 일부 긍정적이어도 현재 글의 증거를 다시 확인하고 안전결제를 사용하세요."
    return "큰 위험 신호는 낮지만 결제 전 판매자 인증과 안전결제를 확인하세요."


seller_context_report_service = SellerContextReportService()
