"""Optional Gemini client for report-chat replies."""

from __future__ import annotations

import os

from app.core.config import get_settings
from app.schemas.chat import ChatRequestPayload


def generate_chat_reply(payload: ChatRequestPayload) -> str | None:
    """Generate a chat reply with Gemini when API credentials are configured."""
    settings = get_settings()
    api_key = settings.gemini_api_key or os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        return None

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=settings.gemini_chat_model,
            contents=_build_chat_prompt(payload),
        )
    except Exception:
        return None

    reply = getattr(response, "text", None)
    if not reply:
        return None
    return reply.strip() or None


def _build_chat_prompt(payload: ChatRequestPayload) -> str:
    """Create a compact prompt grounded in the frontend scan context."""
    scan_result = payload.scan_result
    listing = payload.listing

    context_lines = [
        "You are Safe Ticket's scam-risk assistant.",
        "Answer in Korean unless the user clearly asks for another language.",
        "Be concise, practical, and do not claim certainty beyond the scan data.",
        f"User question: {payload.prompt}",
        f"Page URL: {payload.page_url}",
    ]

    if listing is not None:
        content_text = "\n".join(f"- {block.block_id}: {block.text}" for block in listing.content_blocks[:5])
        context_lines.extend(
            [
                f"Platform: {listing.platform}",
                f"Title: {listing.page_title}",
                f"Price: {listing.price}",
                f"Seller: {listing.seller.nickname} ({listing.seller.seller_id})",
                f"Listing text:\n{content_text}",
            ]
        )

    if scan_result is not None:
        evidence = "\n".join(
            f"- {item.matched_text}: {item.reason}" for item in scan_result.evidence_items[:5]
        )
        actions = "\n".join(
            f"- {item.action}: {item.description}" for item in scan_result.recommended_actions[:5]
        )
        context_lines.extend(
            [
                f"Scan ID: {scan_result.scan_id}",
                f"Risk level: {scan_result.risk_level}",
                f"Risk score: {scan_result.risk_score}",
                f"Risk tags: {', '.join(scan_result.risk_tags)}",
                f"Summary: {scan_result.summary}",
                f"Evidence:\n{evidence or 'None'}",
                f"Recommended actions:\n{actions or 'None'}",
            ]
        )

    if payload.messages:
        history = "\n".join(f"{message.role}: {message.text}" for message in payload.messages[-6:])
        context_lines.append(f"Recent conversation:\n{history}")

    return "\n\n".join(context_lines)
