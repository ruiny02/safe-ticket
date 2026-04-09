import type { ScanCreateRequest, ScanResultResponse } from "../../../shared/types";

export interface PanelReason {
  title: string;
  body: string;
}

export interface PanelMetaItem {
  label: string;
  value: string;
}

export interface PanelContent {
  headline: string;
  tone: "danger" | "warning" | "ok";
  statusLabel: string;
  summary: string;
  reasons: PanelReason[];
  actions: PanelReason[];
  meta: PanelMetaItem[];
}

export function buildPanelContent(options: {
  pageUrl: string;
  payload: ScanCreateRequest | null;
  scanResult: ScanResultResponse | null;
}): PanelContent {
  const { pageUrl, payload, scanResult } = options;

  const meta: PanelMetaItem[] = [
    { label: "현재 페이지", value: pageUrl },
    { label: "백엔드", value: "http://localhost:8000" },
    { label: "데모 페이지", value: "http://localhost:3000/product/227242032.html" },
  ];

  if (!scanResult) {
    return {
      headline: "스캔 준비 완료",
      tone: payload ? "ok" : "warning",
      statusLabel: payload ? "ready" : "waiting",
      summary: payload
        ? "거래 페이지 텍스트를 파싱했습니다. 스캔을 보내면 위험 신호와 하이라이트 위치를 바로 확인할 수 있습니다."
        : "아직 파싱 결과가 없습니다. 페이지 텍스트를 다시 읽어온 뒤 스캔을 보내세요.",
      reasons: payload
        ? [
            {
              title: "현재 잡아둔 대상",
              body: `${payload.page_title} / ${payload.seller.nickname} / ${payload.price.toLocaleString("ko-KR")}원`,
            },
          ]
        : [],
      actions: [
        {
          title: "다음 단계",
          body: "백엔드로 전송을 누르면 위험 문구, 은행/계좌 패턴, 권장 행동을 패널에 표시합니다.",
        },
      ],
      meta,
    };
  }

  const tone = scanResult.risk_level === "high" ? "danger" : scanResult.risk_level === "medium" ? "warning" : "ok";
  const reasons = scanResult.highlight_targets.map((target) => ({
    title: target.matched_text,
    body: target.reason,
  }));

  const actions = scanResult.recommended_actions.map((action) => ({
    title: action.action,
    body: action.description,
  }));

  return {
    headline:
      scanResult.risk_level === "high"
        ? "즉시 확인이 필요한 거래입니다"
        : scanResult.risk_level === "medium"
          ? "추가 확인이 필요한 거래입니다"
          : "현재 규칙 기준으로는 위험도가 낮습니다",
    tone,
    statusLabel: scanResult.status,
    summary:
      scanResult.summary ??
      "응답은 도착했지만 요약 메시지가 비어 있습니다. Raw response를 열어 세부 정보를 확인하세요.",
    reasons,
    actions,
    meta,
  };
}
