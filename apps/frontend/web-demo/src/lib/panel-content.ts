import type { ExternalLookupResult, ScanCreateRequest, ScanHighlightTarget, ScanResultResponse } from "../../../shared/types";
import {
  externalLookupStatusLabel,
  externalLookupTitle,
  formatExternalLookupKeyword,
} from "../../../shared/external-lookup-display";

export interface PanelReason {
  title: string;
  body: string;
}

export interface PanelMetaItem {
  label: string;
  value: string;
}

export interface PanelExternalLookup {
  title: string;
  body: string;
  statusLabel: string;
  tone: "danger" | "warning" | "ok";
  keyword: string;
}

export interface PanelContent {
  headline: string;
  tone: "danger" | "warning" | "ok";
  statusLabel: string;
  summary: string;
  reasons: PanelReason[];
  actions: PanelReason[];
  externalLookups: PanelExternalLookup[];
  meta: PanelMetaItem[];
}

function fallbackReasons(payload: ScanCreateRequest | null): PanelReason[] {
  if (!payload) {
    return [];
  }

  return [
    {
      title: "현재 대상",
      body: `${payload.page_title} / ${payload.seller.nickname} / ${payload.price.toLocaleString("ko-KR")}원`,
    },
  ];
}

function lookupTone(result: ExternalLookupResult): PanelExternalLookup["tone"] {
  if (result.status === "failed" || result.risk_found === true) {
    return "danger";
  }

  if (result.status === "login_required") {
    return "warning";
  }

  return "ok";
}

function buildExternalLookups(results: ExternalLookupResult[] = []): PanelExternalLookup[] {
  return results.slice(0, 4).map((result) => ({
    title: externalLookupTitle(result),
    body: result.message,
    statusLabel: externalLookupStatusLabel(result),
    tone: lookupTone(result),
    keyword: formatExternalLookupKeyword(result),
  }));
}

function uniqueReasons(reasons: PanelReason[], limit: number): PanelReason[] {
  const seen = new Set<string>();
  const unique: PanelReason[] = [];

  for (const reason of reasons) {
    const key = `${reason.title}:${reason.body}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(reason);

    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

export function buildPanelContent(options: {
  pageUrl: string;
  payload: ScanCreateRequest | null;
  scanResult: ScanResultResponse | null;
  appliedHighlights?: ScanHighlightTarget[];
  apiBaseUrl?: string;
  dashboardUrl?: string;
  reportUrl?: string;
}): PanelContent {
  const {
    pageUrl,
    payload,
    scanResult,
    appliedHighlights = [],
    apiBaseUrl = "http://localhost:8000",
    dashboardUrl = "http://localhost:3000/report/#/dashboard",
    reportUrl = "http://localhost:3000/report/#/reports",
  } = options;

  const meta: PanelMetaItem[] = [
    { label: "현재 페이지", value: pageUrl },
    { label: "백엔드", value: apiBaseUrl },
    { label: "대시보드", value: dashboardUrl },
    { label: "리포트", value: reportUrl },
  ];

  if (!scanResult) {
    return {
      headline: payload ? "스캔 준비" : "페이지 정보 대기 중",
      tone: payload ? "ok" : "warning",
      statusLabel: payload ? "ready" : "waiting",
      summary: payload
        ? "페이지를 읽었습니다. 스캔을 보내면 핵심 신호와 다음 행동을 바로 정리해 보여줍니다."
        : "아직 페이지 정보를 읽지 못했습니다. 페이지가 모두 로드된 뒤 다시 시도하세요.",
      reasons: fallbackReasons(payload),
      actions: [
        {
          title: "스캔 실행",
          body: "백엔드로 분석 요청을 보내고 위험 점수, 하이라이트, 권장 행동을 받아옵니다.",
        },
      ],
      externalLookups: [],
      meta,
    };
  }

  if (scanResult.status === "failed") {
    return {
      headline: "스캔 실패",
      tone: "warning",
      statusLabel: scanResult.status,
      summary: scanResult.summary ?? "스캔 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
      reasons: fallbackReasons(payload),
      actions: [
        {
          title: "다시 시도",
          body: "페이지를 다시 읽은 뒤 스캔을 다시 실행해 주세요.",
        },
      ],
      externalLookups: buildExternalLookups(scanResult.external_lookup_results),
      meta,
    };
  }

  const tone =
    scanResult.risk_level === "high"
      ? "danger"
      : scanResult.risk_level === "medium"
        ? "warning"
        : "ok";

  const highlightSource = appliedHighlights.length ? appliedHighlights : scanResult.highlight_targets;
  const reasons = uniqueReasons(
    highlightSource.map((target) => ({
      title: target.matched_text,
      body: target.reason,
    })),
    3,
  );

  const actions = scanResult.recommended_actions.slice(0, 3).map((action) => ({
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
      "요약 문구가 비어 있습니다. 아래 위험 문구와 권장 행동을 먼저 확인해 주세요.",
    reasons: reasons.length ? reasons : fallbackReasons(payload),
    actions: actions.length
      ? actions
      : [
          {
            title: "상세 확인",
            body: "리포트 화면에서 근거와 유사 사례를 함께 확인해 주세요.",
          },
        ],
    externalLookups: buildExternalLookups(scanResult.external_lookup_results),
    meta,
  };
}
