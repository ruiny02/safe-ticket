import type { ExternalLookupResult, ScanCreateRequest, ScanHighlightTarget, ScanResultResponse } from "../../../shared/types";

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
      title: "Parsed listing",
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

function lookupTitle(result: ExternalLookupResult): string {
  const providerLabel = result.provider === "police" ? "Police lookup" : "TheCheat lookup";
  const kindLabel = result.kind === "account" ? "account" : "phone";
  return `${providerLabel} - ${kindLabel}`;
}

function lookupStatus(result: ExternalLookupResult): string {
  if (result.status === "failed") {
    return "failed";
  }

  if (result.status === "login_required") {
    return "login required";
  }

  if (result.risk_found === true) {
    return "risk found";
  }

  if (result.risk_found === false) {
    return "no reports";
  }

  return "completed";
}

function formatLookupKeyword(result: ExternalLookupResult): string {
  const digits = result.keyword.replace(/\D/g, "");

  if (result.kind === "phone" && digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (result.kind === "account" && digits.length === 13) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  }

  return result.keyword;
}

function buildExternalLookups(results: ExternalLookupResult[] = []): PanelExternalLookup[] {
  return results.slice(0, 4).map((result) => ({
    title: lookupTitle(result),
    body: result.message,
    statusLabel: lookupStatus(result),
    tone: lookupTone(result),
    keyword: formatLookupKeyword(result),
  }));
}

export function buildPanelContent(options: {
  pageUrl: string;
  payload: ScanCreateRequest | null;
  scanResult: ScanResultResponse | null;
  appliedHighlights?: ScanHighlightTarget[];
}): PanelContent {
  const { pageUrl, payload, scanResult, appliedHighlights = [] } = options;

  const meta: PanelMetaItem[] = [
    { label: "Current page", value: pageUrl },
    { label: "Backend", value: "http://localhost:8000" },
    { label: "Dashboard", value: "http://localhost:3000/report/#/dashboard" },
    { label: "Report", value: "http://localhost:3000/report/#/reports" },
  ];

  if (!scanResult) {
    return {
      headline: payload ? "Scan ready" : "Waiting for page data",
      tone: payload ? "ok" : "warning",
      statusLabel: payload ? "ready" : "waiting",
      summary: payload
        ? "현재 페이지 정보를 읽었습니다. Scan을 실행하면 위험 점수와 강조 문구를 바로 보여줍니다."
        : "아직 페이지 정보를 읽지 못했습니다. 페이지가 모두 로드된 뒤 다시 시도해 주세요.",
      reasons: fallbackReasons(payload),
      actions: [
        {
          title: "Run scan",
          body: "백엔드로 분석 요청을 보내고 위험 점수, 하이라이트, 권장 행동을 받아옵니다.",
        },
      ],
      externalLookups: [],
      meta,
    };
  }

  if (scanResult.status === "failed") {
    return {
      headline: "Scan failed",
      tone: "warning",
      statusLabel: scanResult.status,
      summary: scanResult.summary ?? "스캔 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
      reasons: fallbackReasons(payload),
      actions: [
        {
          title: "Retry scan",
          body: "페이지를 다시 파싱한 뒤 Scan을 다시 실행해 주세요.",
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

  const highlightSource = appliedHighlights.length ? appliedHighlights : [];

  const reasons = highlightSource.slice(0, 3).map((target) => ({
    title: target.matched_text,
    body: target.reason,
  }));

  const actions = scanResult.recommended_actions.slice(0, 3).map((action) => ({
    title: action.action,
    body: action.description,
  }));

  return {
    headline:
      scanResult.risk_level === "high"
        ? "Immediate review recommended"
        : scanResult.risk_level === "medium"
          ? "Additional review recommended"
          : "Currently looks low risk",
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
            title: "Review details",
            body: "Report 화면에서 근거와 유사 사례를 함께 확인해 주세요.",
          },
        ],
    externalLookups: buildExternalLookups(scanResult.external_lookup_results),
    meta,
  };
}
