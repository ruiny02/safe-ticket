"""Savings-account pattern rules for bank-name and account-number detection."""

from __future__ import annotations

import re

from app.schemas.scan import ContentBlock, EvidenceItem


ACCOUNT_CANDIDATE_PATTERN = re.compile(r"\d[\d-]{8,20}\d")

BANK_ACCOUNT_RULES = [
    {"names": ["국민은행"], "matches": lambda digits: len(digits) == 14 and digits[4:6] in {"03", "23", "26"}},
    {"names": ["신한은행"], "matches": lambda digits: len(digits) == 12 and digits[:3] in {"230", "223"}},
    {"names": ["우리은행"], "matches": lambda digits: len(digits) == 13 and digits[1:4] == "040"},
    {"names": ["하나은행"], "matches": lambda digits: len(digits) == 14 and digits[12:14] in {"21", "25"}},
    {
        "names": ["농협은행", "NH농협은행"],
        "matches": lambda digits: (
            (len(digits) == 11 and digits[:2] in {"03", "34", "47", "49", "59"})
            or (len(digits) == 12 and digits[4:6] in {"04", "34", "47", "49", "59"})
            or (
                len(digits) == 13
                and digits[:3] in {"304", "334", "347", "349", "359", "004", "034", "047", "049", "059"}
            )
        ),
    },
    {"names": ["수협은행"], "matches": lambda digits: len(digits) == 12 and digits[2:6] in {"1400", "1410"}},
    {"names": ["기업은행", "IBK기업은행"], "matches": lambda digits: len(digits) == 14 and digits[9:11] == "14"},
    {"names": ["산업은행"], "matches": lambda digits: len(digits) == 14 and digits[:3] in {"031", "032", "037"}},
    {"names": ["카카오뱅크"], "matches": lambda digits: len(digits) == 13 and digits[1:4] == "355"},
    {"names": ["케이뱅크"], "matches": lambda digits: len(digits) == 12 and digits[:4] == "1102"},
    {"names": ["토스뱅크"], "matches": lambda digits: len(digits) == 12 and digits[:3] == "300"},
    {"names": ["경남은행"], "matches": lambda digits: len(digits) == 13 and digits[:3] in {"225", "229", "231", "241"}},
    {"names": ["광주은행"], "matches": lambda digits: len(digits) in {12, 13} and digits[3:6] == "133"},
    {
        "names": ["대구은행"],
        "matches": lambda digits: len(digits) == 12 and digits[:3].isdigit() and 521 <= int(digits[:3]) <= 527,
    },
    {"names": ["부산은행"], "matches": lambda digits: len(digits) == 13 and digits[:3] == "104"},
    {"names": ["전북은행"], "matches": lambda digits: len(digits) == 13 and digits[:4] == "1031"},
    {
        "names": ["제주은행"],
        "matches": lambda digits: (
            (len(digits) == 10 and digits[1:3].isdigit() and 7 <= int(digits[1:3]) <= 20)
            or (len(digits) == 12 and digits[:3].isdigit() and 730 <= int(digits[:3]) <= 740)
        ),
    },
    {
        "names": ["씨티은행", "한국씨티은행"],
        "matches": lambda digits: len(digits) in {11, 15} and digits[8:10] in {"16", "18", "19", "20", "37", "38", "39"},
    },
    {"names": ["SC제일은행"], "matches": lambda digits: len(digits) == 11 and digits[3:5] == "90"},
]


def build_savings_account_evidence_items(content_blocks: list[ContentBlock]) -> list[EvidenceItem]:
    """Match configured bank names and account-number patterns inside the same text block."""
    evidence_items: list[EvidenceItem] = []

    for block in content_blocks:
        for rule in BANK_ACCOUNT_RULES:
            bank_name, bank_start = _find_bank_name(block.text, rule["names"])
            if bank_name is None or bank_start < 0:
                continue

            for candidate in ACCOUNT_CANDIDATE_PATTERN.finditer(block.text):
                digits_only = re.sub(r"\D", "", candidate.group())
                if not rule["matches"](digits_only):
                    continue

                evidence_items.append(
                    EvidenceItem(
                        block_id=block.block_id,
                        start=bank_start,
                        end=bank_start + len(bank_name),
                        matched_text=bank_name,
                        reason_code="bank_name_detected",
                        reason="The listed bank name matches a monitored account-pattern rule.",
                    )
                )
                evidence_items.append(
                    EvidenceItem(
                        block_id=block.block_id,
                        start=candidate.start(),
                        end=candidate.end(),
                        matched_text=candidate.group(),
                        reason_code="bank_account_pattern",
                        reason=f"This {bank_name} account matches the monitored savings-account pattern.",
                    )
                )

    return evidence_items


def _find_bank_name(text: str, bank_names: list[str]) -> tuple[str | None, int]:
    """Return the first matching bank alias found inside the text block."""
    for bank_name in bank_names:
        start = text.find(bank_name)
        if start >= 0:
            return bank_name, start

    return None, -1
