"""Extract phone and account candidates for external fraud lookups."""

from __future__ import annotations

from dataclasses import dataclass
import re

from app.schemas.external_lookup import ExternalLookupKind, ExternalLookupProvider, ExternalLookupRequest
from app.schemas.scan import ContentBlock
from app.services.rules.savings_account_rules import ACCOUNT_CANDIDATE_PATTERN, BANK_ACCOUNT_RULES


PHONE_CANDIDATE_PATTERN = re.compile(r"(?<!\d)010[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)")
ACCOUNT_CONTEXT_PATTERN = re.compile(r"계좌\s*번호|계좌|입금|은행|통장|예금주")
ACCOUNT_CONTEXT_WINDOW = 30


@dataclass(frozen=True)
class ExternalLookupCandidate:
    """A normalized phone or account number found in scan text."""

    kind: ExternalLookupKind
    keyword: str
    block_id: str
    matched_text: str
    start: int
    end: int

    def to_request(self, provider: ExternalLookupProvider) -> ExternalLookupRequest:
        """Convert this candidate into a provider-specific lookup request."""
        return ExternalLookupRequest(provider=provider, kind=self.kind, keyword=self.keyword)


def extract_external_lookup_candidates(content_blocks: list[ContentBlock]) -> list[ExternalLookupCandidate]:
    """Extract de-duplicated account and Korean mobile phone candidates from scan blocks."""
    candidates: list[ExternalLookupCandidate] = []
    seen: set[tuple[str, str]] = set()

    for block in content_blocks:
        for candidate in _extract_account_candidates(block):
            _append_once(candidates, seen, candidate)
        for candidate in _extract_phone_candidates(block):
            _append_once(candidates, seen, candidate)

    return candidates


def _extract_account_candidates(block: ContentBlock) -> list[ExternalLookupCandidate]:
    """Extract account-looking numbers only when payment context is nearby."""
    candidates: list[ExternalLookupCandidate] = []
    has_bank_name = _contains_known_bank_name(block.text)

    for match in ACCOUNT_CANDIDATE_PATTERN.finditer(block.text):
        digits = _digits_only(match.group())
        if not _looks_like_account_number(digits):
            continue
        if not has_bank_name and not _has_account_context_nearby(block.text, match.start(), match.end()):
            continue

        candidates.append(
            ExternalLookupCandidate(
                kind="account",
                keyword=digits,
                block_id=block.block_id,
                matched_text=match.group(),
                start=match.start(),
                end=match.end(),
            )
        )

    return candidates


def _extract_phone_candidates(block: ContentBlock) -> list[ExternalLookupCandidate]:
    """Extract South Korean 010 mobile phone numbers."""
    candidates: list[ExternalLookupCandidate] = []

    for match in PHONE_CANDIDATE_PATTERN.finditer(block.text):
        digits = _digits_only(match.group())
        if len(digits) != 11:
            continue

        candidates.append(
            ExternalLookupCandidate(
                kind="phone",
                keyword=digits,
                block_id=block.block_id,
                matched_text=match.group(),
                start=match.start(),
                end=match.end(),
            )
        )

    return candidates


def _append_once(
    candidates: list[ExternalLookupCandidate],
    seen: set[tuple[str, str]],
    candidate: ExternalLookupCandidate,
) -> None:
    """Append a candidate once per lookup kind and normalized keyword."""
    key = (candidate.kind, candidate.keyword)
    if key in seen:
        return

    seen.add(key)
    candidates.append(candidate)


def _looks_like_account_number(digits: str) -> bool:
    """Return true for account-length numbers while excluding common 010 phone numbers."""
    return 10 <= len(digits) <= 16 and not (digits.startswith("010") and len(digits) == 11)


def _has_account_context_nearby(text: str, start: int, end: int) -> bool:
    """Check whether account/payment words appear near a numeric candidate."""
    context_start = max(0, start - ACCOUNT_CONTEXT_WINDOW)
    context_end = min(len(text), end + ACCOUNT_CONTEXT_WINDOW)
    return ACCOUNT_CONTEXT_PATTERN.search(text[context_start:context_end]) is not None


def _contains_known_bank_name(text: str) -> bool:
    """Return true when a configured Korean bank alias appears in the block."""
    return any(bank_name in text for rule in BANK_ACCOUNT_RULES for bank_name in rule["names"])


def _digits_only(value: str) -> str:
    """Normalize provider lookup input to digits only."""
    return re.sub(r"\D", "", value)
