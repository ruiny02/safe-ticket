"""Optional Gemini analysis client for the pipeline service."""

from __future__ import annotations

import json
import os
import re
from typing import Any


DEFAULT_ANALYSIS_MODEL = "gemini-2.5-flash"


def analyze_listing_with_gemini(payload: Any, fallback_context: dict[str, Any]) -> dict[str, Any] | None:
    """Ask Gemini for structured risk analysis when credentials are configured."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=os.getenv("GEMINI_ANALYSIS_MODEL", DEFAULT_ANALYSIS_MODEL),
            contents=_build_analysis_prompt(payload, fallback_context),
        )
    except Exception:
        return None

    text = getattr(response, "text", None)
    if not text:
        return None

    try:
        return _validate_analysis_json(_extract_json(text))
    except (json.JSONDecodeError, TypeError, ValueError, KeyError):
        return None


def _build_analysis_prompt(payload: Any, fallback_context: dict[str, Any]) -> str:
    """Create a strict JSON prompt for scam-risk analysis."""
    content_blocks = "\n".join(
        f"- {block.block_id}: {block.text}" for block in payload.content_blocks[:8]
    )
    marketplace_signals = "\n".join(
        f"- {signal.label}: {signal.value}" for signal in payload.marketplace_signals[:8]
    )

    return f"""
You are the Safe Ticket fraud-risk analysis pipeline.
Analyze the marketplace listing and return JSON only.

Required JSON shape:
{{
  "risk_level": "low" | "medium" | "high",
  "risk_score": number from 0 to 1,
  "summary": "short user-facing explanation",
  "risk_tags": ["short_snake_case_tag"],
  "recommended_actions": [
    {{"action": "short_snake_case_action", "description": "specific user-facing action"}}
  ]
}}

Listing:
- scan_id: {payload.scan_id}
- platform: {payload.platform}
- page_url: {payload.page_url}
- title: {payload.page_title}
- price: {payload.price}
- seller: {payload.seller.nickname} ({payload.seller.seller_id})

Content blocks:
{content_blocks}

Marketplace signals:
{marketplace_signals or "None"}

Rule-based fallback context:
{json.dumps(fallback_context, ensure_ascii=False)}
""".strip()


def _extract_json(text: str) -> dict[str, Any]:
    """Parse raw model text that may contain a fenced JSON block."""
    stripped = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL)
    if fenced:
        stripped = fenced.group(1)
    return json.loads(stripped)


def _validate_analysis_json(data: dict[str, Any]) -> dict[str, Any]:
    """Keep only fields that the pipeline response contract understands."""
    risk_level = str(data["risk_level"]).lower()
    if risk_level not in {"low", "medium", "high"}:
        raise ValueError("invalid risk_level")

    risk_score = float(data["risk_score"])
    if risk_score < 0 or risk_score > 1:
        raise ValueError("invalid risk_score")

    summary = str(data["summary"]).strip()
    risk_tags = [str(tag).strip() for tag in data.get("risk_tags", []) if str(tag).strip()]
    recommended_actions = []
    for item in data.get("recommended_actions", []):
        recommended_actions.append(
            {
                "action": str(item["action"]).strip(),
                "description": str(item["description"]).strip(),
            }
        )

    if not summary:
        raise ValueError("summary is required")

    return {
        "risk_level": risk_level,
        "risk_score": round(risk_score, 2),
        "summary": summary,
        "risk_tags": risk_tags,
        "recommended_actions": recommended_actions,
    }
