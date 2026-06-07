import type {
  ExternalLookupResult,
  MarketplaceSignal,
  ScanCreateRequest,
  ScanHighlightTarget,
  ScanResultResponse,
  SimilarCase,
} from "../../../shared/types";

function formatRiskLevel(riskLevel: ScanResultResponse["risk_level"]): string {
  if (riskLevel === "high") {
    return "높음";
  }

  if (riskLevel === "medium") {
    return "보통";
  }

  if (riskLevel === "low") {
    return "낮음";
  }

  return "미확인";
}

function formatRiskScore(riskScore: number | null): string {
  if (riskScore === null) {
    return "--";
  }

  return `${Math.round(riskScore * 100)}점`;
}

function formatPrice(price: number): string {
  return `${price.toLocaleString("ko-KR")}원`;
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function formatSignal(signal: MarketplaceSignal): string {
  return `${signal.label}: ${signal.value}`;
}

function describeEvidence(target: ScanHighlightTarget): string {
  return `"${target.matched_text}" - ${target.reason}`;
}

function describeLookup(result: ExternalLookupResult): string {
  const providerLabel = result.provider === "police" ? "경찰청" : "더치트";
  const keywordLabel = result.kind === "account" ? "계좌" : "전화번호";

  return `${providerLabel} ${keywordLabel} 조회: ${result.message}`;
}

function describeSimilarCase(similarCase: SimilarCase): string {
  return `${similarCase.summary} (유사도 ${Math.round(similarCase.score * 100)}점)`;
}

function orderTrustSignals(signals: MarketplaceSignal[]): MarketplaceSignal[] {
  const priority = new Map<string, number>([
    ["seller_rating", 0],
    ["trust_score", 1],
    ["safe_payment", 2],
    ["safe_payment_count", 3],
    ["review_count", 4],
    ["satisfaction_count", 5],
    ["favorite_count", 6],
    ["transaction_count", 7],
  ]);

  return [...signals].sort((left, right) => {
    const leftPriority = priority.get(left.key) ?? 999;
    const rightPriority = priority.get(right.key) ?? 999;
    return leftPriority - rightPriority;
  });
}

function buildListingSummary(payload: ScanCreateRequest): string {
  const summary = [
    `플랫폼: ${payload.platform === "joonggonara" ? "중고나라" : "번개장터"}`,
    `제목: ${payload.page_title}`,
    `가격: ${formatPrice(payload.price)}`,
    `판매자: ${payload.seller.nickname}`,
    `판매자 ID: ${payload.seller.seller_id}`,
  ];

  if (payload.marketplace_signals.length) {
    summary.push(
      `신뢰지표: ${orderTrustSignals(payload.marketplace_signals)
        .slice(0, 5)
        .map(formatSignal)
        .join(", ")}`,
    );
  }

  return summary.join("\n");
}

function buildRiskSummary(scanResult: ScanResultResponse): string {
  const lines = [
    `현재 위험도는 ${formatRiskLevel(scanResult.risk_level)}이고, 점수는 ${formatRiskScore(scanResult.risk_score)}입니다.`,
  ];

  if (scanResult.summary) {
    lines.push(`요약: ${scanResult.summary}`);
  }

  if (scanResult.highlight_targets.length) {
    lines.push(
      `주요 근거: ${scanResult.highlight_targets
        .slice(0, 3)
        .map((target) => `"${target.matched_text}"`)
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}

function buildTrustSignalSummary(signals: MarketplaceSignal[]): string {
  const visibleSignals = signals.filter((signal) => signal.key !== "safe_payment");

  if (!visibleSignals.length) {
    return "현재 페이지에서 읽은 신뢰지표는 아직 없습니다. 상품 상세나 채팅 화면에 노출된 별점, 거래후기, 안심결제, 단골, 거래내역 같은 정보가 보이는지 함께 확인해 주세요.";
  }

  const orderedSignals = orderTrustSignals(visibleSignals);
  const ratingSignal = orderedSignals.find((signal) => signal.key === "seller_rating");
  const lines = ["현재 읽은 신뢰지표는 아래와 같습니다."];

  if (ratingSignal) {
    lines.push(`- 대표 지표: ${formatSignal(ratingSignal)}`);
  }

  lines.push(...orderedSignals.slice(0, 6).map((signal) => `- ${formatSignal(signal)}`));

  return lines.join("\n");
}

function buildHighlightSummary(highlights: ScanHighlightTarget[]): string {
  if (!highlights.length) {
    return "현재 하이라이트된 위험 표현은 없습니다. 스캔 결과가 낮은 위험이거나, 아직 페이지에서 매칭된 표현이 없을 수 있어요.";
  }

  return [
    "현재 페이지에서 표시된 위험 표현입니다.",
    ...highlights.slice(0, 6).map((target) => `- ${describeEvidence(target)}`),
  ].join("\n");
}

function buildActionSummary(scanResult: ScanResultResponse): string {
  if (!scanResult.recommended_actions.length) {
    return "권장 행동은 아직 비어 있습니다. 우선 판매자 정보, 결제 방식, 하이라이트된 문구를 다시 확인해 보세요.";
  }

  return [
    "지금 바로 확인하면 좋은 항목입니다.",
    ...scanResult.recommended_actions
      .slice(0, 4)
      .map((action, index) => `${index + 1}. ${action.description}`),
  ].join("\n");
}

function buildExternalLookupSummary(results: ExternalLookupResult[] = []): string {
  if (!results.length) {
    return "이번 스캔에서는 계좌번호나 전화번호가 감지되지 않아 외부 조회가 실행되지 않았습니다. 관련 정보가 본문이나 채팅에 있으면 조회 카드가 함께 채워질 수 있어요.";
  }

  return [
    "외부조회 결과를 정리해 드릴게요.",
    ...results.slice(0, 4).map((result) => `- ${describeLookup(result)}`),
  ].join("\n");
}

function buildSimilarCaseSummary(similarCases: SimilarCase[]): string {
  if (!similarCases.length) {
    return "현재 연결된 유사 사례는 없습니다. 다만 지금 파이프라인의 유사 사례는 아직 임시 데이터일 수 있어요.";
  }

  return [
    "현재 결과와 가까운 사례입니다.",
    ...similarCases.slice(0, 3).map((similarCase) => `- ${describeSimilarCase(similarCase)}`),
  ].join("\n");
}

export function buildChatWelcomeMessage(
  payload: ScanCreateRequest | null,
  scanResult: ScanResultResponse | null,
): string {
  if (!payload) {
    return "이 챗봇은 현재 페이지 정보와 스캔 결과를 바탕으로 설명해 드립니다. 페이지 파싱이 끝나면 질문을 이어갈 수 있어요.";
  }

  if (!scanResult) {
    return `${payload.seller.nickname} 판매자의 "${payload.page_title}" 정보를 읽어왔어요. Scan을 실행하면 왜 위험한지, 무엇을 먼저 확인해야 하는지, 신뢰지표가 어떤 의미인지 바로 설명해 드릴게요.`;
  }

  return [
    `스캔이 완료됐어요. 현재 위험도는 ${formatRiskLevel(scanResult.risk_level)}이고 점수는 ${formatRiskScore(scanResult.risk_score)}입니다.`,
    "이제 왜 위험한지, 하이라이트된 문구가 무엇인지, 판매자와 신뢰지표를 어떻게 봐야 하는지 계속 물어볼 수 있어요.",
  ].join("\n");
}

export function buildSuggestedPrompts(
  payload: ScanCreateRequest | null,
  scanResult: ScanResultResponse | null,
): string[] {
  if (!payload) {
    return ["지금 어떤 정보를 읽고 있나요?", "페이지 파싱이 끝났나요?"];
  }

  if (!scanResult) {
    const prompts = ["이 상품 정보를 요약해줘", "신뢰지표를 먼저 보여줘"];

    if (payload.marketplace_signals.length) {
      prompts.push("이 신뢰지표는 어떻게 해석해?");
    } else {
      prompts.push("스캔 전에 무엇을 먼저 확인해야 해?");
    }

    return prompts;
  }

  const prompts = [
    "왜 위험한가요?",
    "무엇을 먼저 확인해야 하나요?",
    "하이라이트된 문구를 설명해줘",
  ];

  if (payload.marketplace_signals.length) {
    prompts.push("신뢰지표를 요약해줘");
  } else if (scanResult.external_lookup_results?.length) {
    prompts.push("외부조회 결과를 알려줘");
  } else {
    prompts.push("판매자 정보를 요약해줘");
  }

  return prompts;
}

export function buildAssistantReply(options: {
  payload: ScanCreateRequest | null;
  prompt: string;
  scanResult: ScanResultResponse | null;
}): string {
  const { payload, prompt, scanResult } = options;
  const normalizedPrompt = prompt.trim().toLowerCase();

  if (!payload) {
    return "아직 페이지 파싱이 끝나지 않았어요. 상품 정보가 읽히면 그 내용을 기준으로 답변할 수 있습니다.";
  }

  if (!scanResult) {
    if (containsAny(normalizedPrompt, ["판매자", "seller", "가격", "price", "제목", "title", "상품", "listing", "요약", "summary"])) {
      return buildListingSummary(payload);
    }

    if (
      containsAny(normalizedPrompt, [
        "신뢰",
        "지표",
        "후기",
        "별점",
        "안심결제",
        "단골",
        "거래내역",
        "trust",
      ])
    ) {
      return buildTrustSignalSummary(payload.marketplace_signals);
    }

    return [
      "아직 Scan 전 상태예요. 먼저 Scan을 실행하면 위험도, 하이라이트 문구, 권장 행동까지 더 정확히 설명할 수 있어요.",
      "",
      buildListingSummary(payload),
    ].join("\n");
  }

  if (scanResult.status === "failed") {
    return "이번 스캔은 실패 상태예요. 서버 연결이나 파이프라인 상태를 확인한 뒤 다시 Scan을 눌러 주세요.";
  }

  if (
    containsAny(normalizedPrompt, [
      "판매자",
      "seller",
      "가격",
      "price",
      "제목",
      "title",
      "상품",
      "listing",
    ])
  ) {
    return buildListingSummary(payload);
  }

  if (
    containsAny(normalizedPrompt, [
      "신뢰",
      "지표",
      "후기",
      "별점",
      "안심결제",
      "단골",
      "거래내역",
      "trust",
    ])
  ) {
    return buildTrustSignalSummary(payload.marketplace_signals);
  }

  if (
    containsAny(normalizedPrompt, [
      "왜",
      "위험",
      "이유",
      "사유",
      "risky",
      "risk",
      "danger",
      "suspicious",
    ])
  ) {
    return [
      buildRiskSummary(scanResult),
      "",
      buildHighlightSummary(scanResult.highlight_targets),
    ].join("\n");
  }

  if (
    containsAny(normalizedPrompt, [
      "무엇",
      "뭘",
      "먼저",
      "확인",
      "검토",
      "조치",
      "행동",
      "check",
      "verify",
      "next",
      "action",
    ])
  ) {
    return buildActionSummary(scanResult);
  }

  if (
    containsAny(normalizedPrompt, [
      "하이라이트",
      "문구",
      "표현",
      "근거",
      "evidence",
      "highlight",
      "phrase",
    ])
  ) {
    return buildHighlightSummary(scanResult.highlight_targets);
  }

  if (
    containsAny(normalizedPrompt, [
      "외부",
      "조회",
      "더치트",
      "경찰",
      "계좌",
      "전화번호",
      "lookup",
      "thecheat",
      "police",
    ])
  ) {
    return buildExternalLookupSummary(scanResult.external_lookup_results);
  }

  if (
    containsAny(normalizedPrompt, [
      "유사",
      "사례",
      "비슷",
      "similar",
      "case",
    ])
  ) {
    return buildSimilarCaseSummary(scanResult.similar_cases);
  }

  if (
    containsAny(normalizedPrompt, [
      "점수",
      "위험도",
      "score",
      "level",
      "summary",
      "요약",
    ])
  ) {
    return buildRiskSummary(scanResult);
  }

  if (containsAny(normalizedPrompt, ["report", "dashboard", "리포트", "대시보드"])) {
    return "패널의 Dashboard 버튼에서는 스캔 결과 흐름을, Report 버튼에서는 상세 결과 페이지를 열 수 있어요. 현재 스캔 결과를 기준으로 이어지는 화면입니다.";
  }

  if (containsAny(normalizedPrompt, ["사도", "구매", "buy", "safe"])) {
    return [
      buildRiskSummary(scanResult),
      "",
      "다만 이 결과만으로 거래 안전을 보장할 수는 없어요. 반드시 결제 방식, 판매자 정보, 신뢰지표, 하이라이트된 표현을 함께 확인해 주세요.",
    ].join("\n");
  }

  return [
    "현재 스캔 결과를 바탕으로 답변하고 있어요.",
    "",
    buildRiskSummary(scanResult),
    "",
    "예를 들어 이렇게 물어볼 수 있어요:",
    '- "왜 위험한가요?"',
    '- "무엇을 먼저 확인해야 하나요?"',
    '- "신뢰지표를 요약해줘"',
    '- "외부조회 결과를 알려줘"',
  ].join("\n");
}
