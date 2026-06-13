import type { ScanCreateRequest, ScanHighlightTarget } from "../../../shared/types";

interface LocalChatRiskRule {
  reasonCode: string;
  reason: string;
  pattern: RegExp;
}

const LOCAL_CHAT_RISK_RULES: LocalChatRiskRule[] = [
  {
    reasonCode: "avoid_safe_payment",
    reason: "플랫폼 안전결제 또는 번개페이를 회피하는 표현입니다.",
    pattern:
      /안심결제는 정산이 늦어서 안 하고|번개페이는 정산이 늦어서 안 받아요|안심결제[^.!?\n]{0,24}(?:안 하고|안 받아요|못 해요|정산이 늦)|번개페이[^.!?\n]{0,24}(?:안 하고|안 받아요|못 해요|정산이 늦)/g,
  },
  {
    reasonCode: "off_platform_contact",
    reason: "플랫폼 밖 메신저나 문자로 이동을 유도하는 표현입니다.",
    pattern: /카톡 오픈채팅|오픈채팅|카카오톡|카톡|문자로 연락|문자|텔레그램|라인/g,
  },
  {
    reasonCode: "prepayment_pressure",
    reason: "선입금 또는 예약금을 먼저 요구하는 표현입니다.",
    pattern: /예약금 먼저 입금|먼저 입금|선입금|예약금/g,
  },
  {
    reasonCode: "urgency_pressure",
    reason: "거래 결정을 서두르게 만드는 시간 압박 표현입니다.",
    pattern: /오늘 안에 바로 입금|오늘 안에 입금|지금 문의가 많아서|다음 분께 먼저|다음 분께 넘길게요/g,
  },
  {
    reasonCode: "savings_account_pattern",
    reason: "적금계좌로 의심되는 은행별 계좌 패턴입니다.",
    pattern: /(?:농협은행|NH농협은행|농협)\s*304[\d-\s]{10,18}|케이뱅크\s*1102[\d-\s]{8,16}|(?:카카오뱅크|카뱅)\s*\d?355[\d-\s]{8,16}/g,
  },
];

export function buildLocalChatHighlightTargets(payload: ScanCreateRequest): ScanHighlightTarget[] {
  const targets: ScanHighlightTarget[] = [];

  for (const block of payload.content_blocks) {
    if (!block.block_id || !block.text) {
      continue;
    }

    for (const rule of LOCAL_CHAT_RISK_RULES) {
      rule.pattern.lastIndex = 0;

      for (const match of block.text.matchAll(rule.pattern)) {
        const matchedText = match[0].trim();
        if (!matchedText) {
          continue;
        }

        const start = match.index ?? block.text.indexOf(match[0]);
        targets.push({
          block_id: block.block_id,
          start,
          end: start + match[0].length,
          matched_text: matchedText,
          reason_code: rule.reasonCode,
          reason: rule.reason,
          css_class: "safe-ticket-highlight-danger",
        });
      }
    }
  }

  return targets;
}

export function mergeHighlightTargets(
  backendTargets: ScanHighlightTarget[] = [],
  localTargets: ScanHighlightTarget[] = [],
): ScanHighlightTarget[] {
  const merged: ScanHighlightTarget[] = [];
  const seen = new Set<string>();

  for (const target of [...backendTargets, ...localTargets]) {
    const key = `${target.block_id}:${target.matched_text}:${target.reason_code}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(target);
  }

  return merged;
}
