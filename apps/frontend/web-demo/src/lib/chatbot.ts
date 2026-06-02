import type { ScanCreateRequest, ScanResultResponse } from "../../../shared/types";

export function buildChatWelcomeMessage(
  payload: ScanCreateRequest | null,
  scanResult: ScanResultResponse | null,
): string {
  if (!payload) {
    return "이 패널은 현재 상품 정보와 스캔 결과를 바탕으로 안내합니다. 페이지 파싱이 끝나면 질문을 이어갈 수 있어요.";
  }

  if (!scanResult) {
    return `${payload.seller.nickname} 판매자의 "${payload.page_title}" 정보를 읽어왔어요. Scan을 실행하면 왜 위험한지, 무엇을 확인해야 하는지 바로 설명해 드릴게요.`;
  }

  const riskScore = scanResult.risk_score === null ? "--" : Math.round(scanResult.risk_score * 100);
  const riskLevel = scanResult.risk_level ?? "unknown";

  return `스캔이 완료됐어요. 현재 위험도는 ${riskLevel} (${riskScore}) 입니다. "왜 위험한가요?" 또는 "무엇을 확인해야 하나요?"처럼 물어보세요.`;
}

export function buildAssistantReply(options: {
  payload: ScanCreateRequest | null;
  prompt: string;
  scanResult: ScanResultResponse | null;
}): string {
  const { payload, prompt, scanResult } = options;
  const normalizedPrompt = prompt.toLowerCase();

  if (!payload) {
    return "아직 페이지 파싱이 끝나지 않았어요. 상품 정보가 읽히면 그 내용을 기준으로 답변할 수 있습니다.";
  }

  if (!scanResult) {
    return "아직 Scan 전 상태예요. 먼저 Scan을 눌러 위험 신호를 분석하면 더 정확히 답변할 수 있어요.";
  }

  if (
    normalizedPrompt.includes("why") ||
    normalizedPrompt.includes("risk") ||
    prompt.includes("왜") ||
    prompt.includes("위험")
  ) {
    const topReason = scanResult.highlight_targets[0];
    if (topReason) {
      return `현재 판단에서 가장 먼저 잡힌 신호는 "${topReason.matched_text}" 입니다. 사유는 ${topReason.reason} 이고, 이 문구가 판매자의 송금 유도나 거래 압박과 연결되는지 함께 확인하는 게 좋아요.`;
    }
  }

  if (
    normalizedPrompt.includes("what") ||
    normalizedPrompt.includes("check") ||
    normalizedPrompt.includes("verify")
  ) {
    const topAction = scanResult.recommended_actions[0];
    if (topAction) {
      return `가장 먼저 할 일은 ${topAction.action} 입니다. ${topAction.description}`;
    }
  }

  if (normalizedPrompt.includes("score") || prompt.includes("점수")) {
    const riskScore = scanResult.risk_score === null ? "--" : Math.round(scanResult.risk_score * 100);
    return `현재 위험 점수는 ${riskScore}점이고, 위험도는 ${scanResult.risk_level ?? "unknown"} 입니다. 이 점수는 감지된 위험 문구와 권장 행동을 함께 반영한 결과예요.`;
  }

  return `현재 게시글 "${payload.page_title}" 기준으로 스캔 결과를 보고 있어요. 위험 문구, 판매자 정보, 권장 행동 중 어떤 부분이 궁금한지 더 구체적으로 물어보면 바로 정리해 드릴게요.`;
}
