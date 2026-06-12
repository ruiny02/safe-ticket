import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";

import { getSafeTicketApiBaseUrl, getSafeTicketFrontendBaseUrl } from "../../shared/runtime-config";
import { createSellerContextReport, getCaseRiskMap, getPipelineDebug, getScan } from "../../shared/scan-api";
import type {
  PipelineExchangeResponse,
  RiskMapResponse,
  ScanResultResponse,
  SellerContextReportResponse,
  UserProfile,
  UserTradeExperienceLevel,
} from "../../shared/types";
import { buildDashboardModel, type DashboardModel } from "./lib/dashboard-model";
import { buildDemoEmbeddingResult, type DemoEmbeddingPoint } from "./lib/demo-embedding";
import {
  buildStarPolygonPoints,
  projectEmbeddingAxis3D,
  projectEmbeddingPoint3D,
  projectEmbeddingPoints3D,
  type ProjectedEmbeddingPoint,
} from "./lib/embedding-projection";
import { buildRouteHref, parseReportRoute, shouldRefreshReportData, type ReportView } from "./lib/navigation";
import { buildReportBrief } from "./lib/report-brief";

const API_BASE_URL = getSafeTicketApiBaseUrl();
const FRONTEND_BASE_URL = getSafeTicketFrontendBaseUrl();
const DEMO_PAGE_URL = `${FRONTEND_BASE_URL}/product/227242032.html`;
const DEMO_JOONGNA_CHAT_URL = `${FRONTEND_BASE_URL}/joongna-chat.html`;
const DEMO_BUNJANG_CHAT_URL = `${FRONTEND_BASE_URL}/bunjang-chat.html`;
const HEALTHCHECK_URL = `${API_BASE_URL}/api/v1/health/live`;
const USER_PROFILE_STORAGE_KEY = "safeTicketUserProfile";

type Tone = "danger" | "warning" | "ok" | "neutral";
type SignalFlag = "Matched" | "Review" | "Not found";
type ProfileSaveStatus = "자동 저장" | "저장됨";

const EXPERIENCE_LEVELS: UserTradeExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const EXPERIENCE_LABELS: Record<UserTradeExperienceLevel, string> = {
  beginner: "초급",
  intermediate: "중급",
  advanced: "고급",
};

const DASHBOARD_OVERVIEW_ITEMS = [
  {
    label: "Scan quality",
    value: "84%",
    detail: "보호 점수 기준에서 상위 12% 개선",
    tone: "danger" as const,
  },
  {
    label: "Protected buyers",
    value: "312",
    detail: "최근 7일 동안 보호 기준으로 재가공된 사용자 수",
    tone: "ok" as const,
  },
  {
    label: "Manual review",
    value: "19",
    detail: "수동 검토로 넘긴 거래. watchlist 기준 -4%",
    tone: "warning" as const,
  },
];

const SIGNAL_ROWS: Array<{
  source: string;
  status: SignalFlag;
  location: string;
  excerpt: string;
  detail: string;
}> = [
  {
    source: "적금통장 패턴",
    status: "Matched",
    location: "상품 본문 > 계좌 번호",
    excerpt: "3355-28-8620726",
    detail: "카카오뱅크 355 패턴과 유사한 계좌 형식",
  },
  {
    source: "모니터링 은행명",
    status: "Matched",
    location: "상품 본문 > 입금 은행",
    excerpt: "카카오뱅크",
    detail: "사기 악용 빈도가 높은 은행명 언급",
  },
  {
    source: "시간 압박 표현",
    status: "Review",
    location: "상품 본문 > 거래 설명",
    excerpt: "답변 지연 시 다음 분께 넘어갈 수 있습니다.",
    detail: "거래 결정을 서두르게 만드는 문구",
  },
  {
    source: "외부 메신저 이동",
    status: "Not found",
    location: "-",
    excerpt: "-",
    detail: "현재 데모 게시글에서는 직접 매칭되지 않음",
  },
];

const RECENT_SCANS = [
  { id: "scan_41f2a8a9", title: "뮤지컬 티켓 양도", tone: "danger" as Tone, summary: "계좌 재전송과 외부 메신저 이동이 함께 감지됨" },
  { id: "scan_20ce1f11", title: "콘서트 플로어 좌석 급처", tone: "warning" as Tone, summary: "급한 입금 유도 표현과 과도한 할인 문구 감지" },
  { id: "scan_8d93a4bb", title: "정가 양도 게시글", tone: "ok" as Tone, summary: "현재 규칙 기준 뚜렷한 경고는 적음" },
  { id: "scan_921ce7df", title: "아이돌 팬미팅 양도", tone: "warning" as Tone, summary: "본인 확인 정보 요구와 메신저 이동이 동시에 감지됨" },
];

function emptyUserProfile(): UserProfile {
  return {
    age: null,
    trade_experience_level: null,
  };
}

function normalizeUserProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object") {
    return emptyUserProfile();
  }

  const rawProfile = value as {
    age?: unknown;
    trade_experience_level?: unknown;
  };
  const age = typeof rawProfile.age === "number" && Number.isFinite(rawProfile.age) ? rawProfile.age : null;
  const tradeExperienceLevel = EXPERIENCE_LEVELS.includes(rawProfile.trade_experience_level as UserTradeExperienceLevel)
    ? (rawProfile.trade_experience_level as UserTradeExperienceLevel)
    : null;

  return {
    age,
    trade_experience_level: tradeExperienceLevel,
  };
}

function loadReportUserProfile(): UserProfile {
  if (typeof window === "undefined") {
    return emptyUserProfile();
  }

  try {
    return normalizeUserProfile(JSON.parse(window.localStorage.getItem(USER_PROFILE_STORAGE_KEY) ?? "null"));
  } catch {
    return emptyUserProfile();
  }
}

function saveReportUserProfile(profile: UserProfile): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function buildSampleScanResult(
  scanId: string,
  riskLevel: NonNullable<ScanResultResponse["risk_level"]>,
  riskScore: number,
  summary: string,
  highlights: Array<{ text: string; reason: string }>,
  actions: string[],
): ScanResultResponse {
  const highlightTargets = highlights.map((item, index) => ({
    block_id: "body-1",
    start: index * 10,
    end: index * 10 + item.text.length,
    matched_text: item.text,
    reason_code: `sample-${index}`,
    reason: item.reason,
    css_class: riskLevel === "high" ? "safe-ticket-highlight-danger" : "safe-ticket-highlight-warning",
  }));

  return {
    scan_id: scanId,
    status: "completed",
    risk_level: riskLevel,
    risk_score: riskScore,
    summary,
    risk_tags: highlights.map((item) => item.text),
    evidence_items: highlightTargets,
    highlight_targets: highlightTargets,
    similar_cases: [
      {
        case_id: `${scanId}-similar-1`,
        score: Math.max(0.51, Math.min(0.93, riskScore + 0.08)),
        summary,
      },
    ],
    recommended_actions: actions.map((action, index) => ({
      action: `권장 행동 ${index + 1}`,
      description: action,
    })),
    external_lookup_results: [],
    degraded: false,
    report_url: null,
  };
}

const SAMPLE_SCAN_RESULTS: Record<string, ScanResultResponse> = {
  scan_41f2a8a9: buildSampleScanResult(
    "scan_41f2a8a9",
    "high",
    0.82,
    "계좌 재전송 요청과 외부 메신저 이동 문구가 함께 감지돼 위험도가 높습니다.",
    [
      { text: "계좌 다시 보내드릴게요", reason: "계좌 재전송 요청이 반복될 때 사칭 또는 대리 판매 가능성을 의심해야 합니다." },
      { text: "카톡으로 연락 주세요", reason: "플랫폼 밖 메신저 이동은 분쟁 보호 범위를 벗어날 가능성이 큽니다." },
    ],
    ["플랫폼 안심결제 여부를 먼저 확인하세요.", "판매자 계정과 계좌 명의가 일치하는지 추가 확인하세요."],
  ),
  scan_20ce1f11: buildSampleScanResult(
    "scan_20ce1f11",
    "medium",
    0.56,
    "급한 입금 유도 표현과 과도한 할인 문구가 함께 잡혀 추가 확인이 필요합니다.",
    [
      { text: "오늘 안에 입금 가능하신 분만", reason: "시간 압박 문구는 거래 결정을 서두르게 만듭니다." },
      { text: "시세보다 싸게", reason: "과도한 할인은 미끼 매물일 가능성이 있습니다." },
    ],
    ["판매 내역과 실물 인증을 먼저 요청하세요.", "입금 전 좌석 정보와 예매 내역을 다시 확인하세요."],
  ),
  scan_8d93a4bb: buildSampleScanResult(
    "scan_8d93a4bb",
    "low",
    0.14,
    "현재 규칙 기준으로는 뚜렷한 고위험 신호가 적습니다.",
    [{ text: "정가 양도", reason: "가격 관련 신호는 있으나 과도한 압박이나 외부 이동은 적습니다." }],
    ["거래 전 본인 인증과 예매 내역을 한 번 더 확인하세요."],
  ),
  scan_921ce7df: buildSampleScanResult(
    "scan_921ce7df",
    "medium",
    0.61,
    "본인 확인 정보 요구와 메신저 이동 문구가 같이 감지돼 주의가 필요합니다.",
    [
      { text: "신분증 일부 보여주세요", reason: "과도한 개인정보 요구는 2차 피해로 이어질 수 있습니다." },
      { text: "오픈채팅으로 이동", reason: "플랫폼 외부로 이동하면 보호 장치가 약해집니다." },
    ],
    ["민감한 개인정보는 가리고 전달하세요.", "플랫폼 내 채팅과 결제 수단을 우선 사용하세요."],
  ),
};

const SAMPLE_PIPELINE_DEBUG: Record<string, PipelineExchangeResponse> = {
  scan_41f2a8a9: {
    scan_id: "scan_41f2a8a9",
    outbound_payload: {
      scan_id: "scan_41f2a8a9",
      platform: "joonggonara",
      page_url: "https://web.joongna.com/product/229241708",
      page_title: "뮤지컬 티켓 양도",
      price: 180000,
      seller: { seller_id: "seller-410", nickname: "뮤지컬양도맨" },
      content_blocks: [{ block_id: "body-1", text: "계좌 다시 보내드릴게요. 카톡으로 연락 주세요." }],
      marketplace_signals: [],
      user_profile: null,
    },
    inbound_payload: {
      risk_level: "high",
      risk_score: 0.82,
      summary: "계좌 재전송 요청과 외부 메신저 이동 문구가 함께 감지돼 위험도가 높습니다.",
      risk_tags: ["계좌 다시 보내드릴게요", "카톡으로 연락 주세요"],
      evidence_items: [],
      highlight_targets: [],
      similar_cases: [],
      recommended_actions: [],
      degraded: false,
    },
  },
  scan_20ce1f11: {
    scan_id: "scan_20ce1f11",
    outbound_payload: {
      scan_id: "scan_20ce1f11",
      platform: "bunjang",
      page_url: "https://m.bunjang.co.kr/products/411763350",
      page_title: "콘서트 플로어 좌석 급처",
      price: 95000,
      seller: { seller_id: "seller-233", nickname: "플로어양도" },
      content_blocks: [{ block_id: "body-1", text: "오늘 안에 입금 가능하신 분만 연락 주세요. 시세보다 싸게 드려요." }],
      marketplace_signals: [],
      user_profile: null,
    },
    inbound_payload: {
      risk_level: "medium",
      risk_score: 0.56,
      summary: "급한 입금 유도 표현과 과도한 할인 문구가 함께 잡혀 추가 확인이 필요합니다.",
      risk_tags: ["오늘 안에 입금 가능하신 분만", "시세보다 싸게"],
      evidence_items: [],
      highlight_targets: [],
      similar_cases: [],
      recommended_actions: [],
      degraded: false,
    },
  },
  scan_8d93a4bb: {
    scan_id: "scan_8d93a4bb",
    outbound_payload: {
      scan_id: "scan_8d93a4bb",
      platform: "joonggonara",
      page_url: "https://web.joongna.com/product/229245101",
      page_title: "정가 양도 게시글",
      price: 230000,
      seller: { seller_id: "seller-812", nickname: "고상한사고견과류" },
      content_blocks: [{ block_id: "body-1", text: "정가 양도합니다. 예매 내역 확인 가능합니다." }],
      marketplace_signals: [],
      user_profile: null,
    },
    inbound_payload: {
      risk_level: "low",
      risk_score: 0.14,
      summary: "현재 규칙 기준으로는 뚜렷한 고위험 신호가 적습니다.",
      risk_tags: ["정가 양도"],
      evidence_items: [],
      highlight_targets: [],
      similar_cases: [],
      recommended_actions: [],
      degraded: false,
    },
  },
  scan_921ce7df: {
    scan_id: "scan_921ce7df",
    outbound_payload: {
      scan_id: "scan_921ce7df",
      platform: "bunjang",
      page_url: "https://m.bunjang.co.kr/products/410576644",
      page_title: "아이돌 팬미팅 양도",
      price: 72000,
      seller: { seller_id: "seller-921", nickname: "팬미팅양도" },
      content_blocks: [{ block_id: "body-1", text: "신분증 일부 보여주세요. 오픈채팅으로 이동 부탁드려요." }],
      marketplace_signals: [],
      user_profile: null,
    },
    inbound_payload: {
      risk_level: "medium",
      risk_score: 0.61,
      summary: "본인 확인 정보 요구와 메신저 이동 문구가 같이 감지돼 주의가 필요합니다.",
      risk_tags: ["신분증 일부 보여주세요", "오픈채팅으로 이동"],
      evidence_items: [],
      highlight_targets: [],
      similar_cases: [],
      recommended_actions: [],
      degraded: false,
    },
  },
};

function getCurrentRoute() {
  if (typeof window === "undefined") {
    return { view: "dashboard" as const, scanId: null };
  }

  return parseReportRoute(window.location.hash, window.location.search);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function pollScanResult(scanId: string): Promise<ScanResultResponse> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await getScan(API_BASE_URL, scanId);
    if (result.status !== "queued" && result.status !== "processing") {
      return result;
    }

    await wait(1000);
  }

  throw new Error("Timed out while waiting for report data");
}

function formatPercent(score: number | null): string {
  if (score === null || Number.isNaN(score)) {
    return "--";
  }

  return `${Math.round(score * 100)}%`;
}

function toneLabel(tone: Tone): string {
  if (tone === "danger") {
    return "High";
  }
  if (tone === "warning") {
    return "Medium";
  }
  if (tone === "ok") {
    return "Low";
  }
  return "Ready";
}

function signalPillClass(status: SignalFlag): string {
  if (status === "Matched") {
    return "dashboard-pill is-danger";
  }

  if (status === "Review") {
    return "dashboard-pill is-warning";
  }

  return "dashboard-pill is-neutral";
}

function getToneClass(tone: Tone): string {
  return `is-${tone}`;
}

function topActionMeta(view: ReportView) {
  if (view === "settings") {
    return {
      title: "Settings",
      copy: "나이와 중고거래 경험을 입력해 scan 위험도 계산에 사용할 사용자 맥락을 설정합니다.",
      pill: "Profile",
    };
  }

  if (view === "reports") {
    return {
      title: "Reports",
      copy: "한 건의 scan을 짧고 선명하게 정리한 해설 페이지입니다. 왜 위험하다고 봤는지와 지금 어떤 대응이 필요한지만 문장 중심으로 보여줍니다.",
      pill: "Narrative",
    };
  }

  return {
    title: "Dashboard",
    copy: "현재 스캔의 핵심 신호, 판매자 정보, 외부 조회 결과, 임베딩 위치를 한 화면에서 빠르게 확인하는 분석 대시보드입니다.",
    pill: "Workspace",
  };
}

function iconSvg(path: string) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d={path} />
    </svg>
  );
}

function IconButton({ children }: { children: ReactNode }) {
  return <button className="dashboard-topicon" type="button">{children}</button>;
}

function getSampleScanContext(scanId: string) {
  const scanResult = SAMPLE_SCAN_RESULTS[scanId];
  if (!scanResult) {
    return null;
  }

  return {
    scanResult,
    pipelineDebug: SAMPLE_PIPELINE_DEBUG[scanId] ?? null,
    caseUmap: null,
  };
}

function OverviewCard({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{ label: string; value: string; detail: string; tone: Tone }>;
}) {
  return (
    <article className="dashboard-card dashboard-col-12 dashboard-overview-card">
      <header className="dashboard-card-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      <div className="dashboard-card-body">
        <div className="dashboard-overview-grid">
          {items.map((item) => (
            <section className="dashboard-overview-item" key={item.label}>
              <div className="dashboard-micro-label">{item.label}</div>
              <div className="dashboard-summary-value">
                <strong>{item.value}</strong>
                <span className={`dashboard-pill ${getToneClass(item.tone)}`}>{toneLabel(item.tone)}</span>
              </div>
              <p>{item.detail}</p>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

function EmbeddingMap({ points }: { points: DemoEmbeddingPoint[] }) {
  const currentPoint = points.find((point) => point.variant === "current");
  const historicalPoints = points.filter((point) => point.variant !== "current");

  return (
    <div className="dashboard-embedding-plot-shell is-2d">
      <svg className="dashboard-embedding-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="embedding-2d-glow" cx="74%" cy="18%" r="68%">
            <stop offset="0%" stopColor="rgba(132, 112, 255, 0.18)" />
            <stop offset="55%" stopColor="rgba(132, 112, 255, 0.04)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
          </radialGradient>
        </defs>
        <rect className="embedding-plot-bg" x="0" y="0" width="100" height="100" rx="5" />
        <rect className="embedding-plot-glow" x="0" y="0" width="100" height="100" rx="5" fill="url(#embedding-2d-glow)" />
        {[20, 40, 60, 80].map((tick) => (
          <line className="embedding-grid-line" key={`h-${tick}`} x1="8" x2="94" y1={tick} y2={tick} />
        ))}
        {[20, 40, 60, 80].map((tick) => (
          <line className="embedding-grid-line" key={`v-${tick}`} x1={tick} x2={tick} y1="8" y2="92" />
        ))}
        <line className="embedding-axis-line" x1="8" x2="94" y1="92" y2="92" />
        <line className="embedding-axis-line" x1="8" x2="8" y1="8" y2="92" />
        <text className="embedding-axis-label" x="78" y="88">PLS1 risk</text>
        <text className="embedding-axis-label is-y" x="12" y="13">Semantic residual</text>
        {historicalPoints.map((point) => (
          <g key={point.id}>
            <circle
              className={`embedding-point ${point.variant}`}
              cx={point.x}
              cy={point.y}
              r="1.2"
            />
          </g>
        ))}
        {currentPoint ? (
          <>
            <line className="embedding-current-guide" x1={currentPoint.x} x2={currentPoint.x} y1="8" y2="92" />
            <line className="embedding-current-guide" x1="8" x2="94" y1={currentPoint.y} y2={currentPoint.y} />
            <polygon
              className="embedding-current-star-halo"
              points={buildStarPolygonPoints({
                centerX: currentPoint.x,
                centerY: currentPoint.y,
                outerRadius: 5.2,
                innerRadius: 2.3,
              })}
            />
            <polygon
              className="embedding-current-star"
              points={buildStarPolygonPoints({
                centerX: currentPoint.x,
                centerY: currentPoint.y,
                outerRadius: 3.9,
                innerRadius: 1.7,
              })}
            />
          </>
        ) : null}
      </svg>
      <div className="dashboard-embedding-plot-caption">
        <span>orthographic x/y slice</span>
        <strong>{points.length} points</strong>
      </div>
    </div>
  );
}

function ClusterLegend() {
  return (
    <div className="dashboard-embedding-legend" aria-label="Embedding cluster legend">
      {[
        ["fraud", "Fraud"],
        ["borderline", "Borderline"],
        ["safe", "Safe"],
        ["current", "Current"],
      ].map(([variant, label]) => (
        <span key={variant}>
          <i className={`embedding-legend-dot ${variant}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

function buildCubeEdges(camera: { pitch: number; yaw: number; zoom: number }) {
  const corners = [
    [18, 18, 18],
    [82, 18, 18],
    [82, 82, 18],
    [18, 82, 18],
    [18, 18, 82],
    [82, 18, 82],
    [82, 82, 82],
    [18, 82, 82],
  ] as const;
  const edgeIndexes = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  const projectedCorners = corners.map(([x, y, z], index) =>
    projectEmbeddingPoint3D(
      {
        id: `corner-${index}`,
        label: `corner-${index}`,
        variant: "safe",
        x,
        y,
        z,
      },
      camera,
    ),
  );

  return edgeIndexes.map(([startIndex, endIndex]) => {
    const start = projectedCorners[startIndex];
    const end = projectedCorners[endIndex];
    return {
      id: `${start.id}-${end.id}`,
      x1: start.screenX,
      y1: start.screenY,
      x2: end.screenX,
      y2: end.screenY,
      depth: (start.depth + end.depth) / 2,
    };
  });
}

function PointTooltip({ point }: { point: ProjectedEmbeddingPoint }) {
  return (
    <div
      className="dashboard-embedding-tooltip"
      style={{
        left: `${point.screenX}%`,
        top: `${point.screenY}%`,
      }}
    >
      <strong>{point.label}</strong>
      <span>
        {typeof point.riskScore === "number" ? `risk ${Math.round(point.riskScore * 100)} / ` : ""}
        z {point.z.toFixed(1)}
      </span>
    </div>
  );
}

function EmbeddingMap3D({ points }: { points: DemoEmbeddingPoint[] }) {
  const [camera, setCamera] = useState({ pitch: -31, yaw: 42, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; pitch: number; yaw: number } | null>(null);
  const projectedPoints = useMemo(() => projectEmbeddingPoints3D(points, camera), [camera, points]);
  const historicalProjectedPoints = projectedPoints.filter((point) => point.variant !== "current");
  const currentProjectedPoint = projectedPoints.find((point) => point.variant === "current") ?? null;
  const axes = useMemo(
    () => [
      ["x", projectEmbeddingAxis3D("x", camera)],
      ["y", projectEmbeddingAxis3D("y", camera)],
      ["z", projectEmbeddingAxis3D("z", camera)],
    ] as const,
    [camera],
  );
  const cubeEdges = useMemo(() => buildCubeEdges(camera), [camera]);
  const hoveredPoint = hoveredPointId ? projectedPoints.find((point) => point.id === hoveredPointId) : null;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      pitch: camera.pitch,
      yaw: camera.yaw,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart) {
      return;
    }

    const deltaX = event.clientX - dragStart.pointerX;
    const deltaY = event.clientY - dragStart.pointerY;
    setCamera((current) => ({
      ...current,
      pitch: clamp(dragStart.pitch - deltaY * 0.28, -74, 34),
      yaw: dragStart.yaw + deltaX * 0.34,
    }));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;
    setIsDragging(false);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setCamera((current) => ({
      ...current,
      zoom: clamp(current.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.72, 1.72),
    }));
  };

  return (
    <div className="dashboard-embedding-3d-shell">
      <div className="dashboard-embedding-3d-meta">
        <span>Drag orbit</span>
        <span>Wheel zoom</span>
        <button
          onClick={() => {
            setCamera({ pitch: -31, yaw: 42, zoom: 1 });
          }}
          type="button"
        >
          Reset
        </button>
      </div>
      <div
        aria-label="Interactive 3D embedding map. Drag to rotate and use mouse wheel to zoom."
        className={`dashboard-embedding-3d${isDragging ? " is-dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        role="img"
      >
        <svg className="dashboard-embedding-3d-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="embedding-3d-orb" cx="72%" cy="18%" r="72%">
              <stop offset="0%" stopColor="rgba(139, 92, 246, 0.24)" />
              <stop offset="48%" stopColor="rgba(20, 184, 166, 0.08)" />
              <stop offset="100%" stopColor="rgba(15, 23, 42, 0)" />
            </radialGradient>
            <linearGradient id="embedding-3d-grid" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.1)" />
              <stop offset="100%" stopColor="rgba(132, 112, 255, 0.02)" />
            </linearGradient>
          </defs>
          <rect className="embedding-3d-bg" x="0" y="0" width="100" height="100" rx="6" />
          <rect x="0" y="0" width="100" height="100" rx="6" fill="url(#embedding-3d-orb)" />
          {[18, 34, 50, 66, 82].map((tick) => (
            <g key={tick}>
              <line className="embedding-3d-grid-line" x1="10" x2="90" y1={tick} y2={tick} />
              <line className="embedding-3d-grid-line" x1={tick} x2={tick} y1="10" y2="90" />
            </g>
          ))}
          {cubeEdges.map((edge) => (
            <line
              className="embedding-3d-cube-line"
              key={edge.id}
              opacity={0.2 + Math.max(0, Math.min(1, (edge.depth + 1.2) / 2.4)) * 0.4}
              x1={edge.x1}
              x2={edge.x2}
              y1={edge.y1}
              y2={edge.y2}
            />
          ))}
          {axes.map(([axis, line]) => (
            <g className={`embedding-3d-axis-group is-${axis}`} key={axis}>
              <line className="embedding-3d-axis-line" x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
              <text className="embedding-3d-axis-label" x={line.x2 + 1.6} y={line.y2 + 1.6}>
                {axis.toUpperCase()}
              </text>
            </g>
          ))}
          {historicalProjectedPoints.map((point) => (
            <g
              className={`embedding-3d-point-group ${point.variant}`}
              key={point.id}
              opacity={point.opacity}
              onMouseEnter={() => setHoveredPointId(point.id)}
              onMouseLeave={() => setHoveredPointId(null)}
            >
              <circle
                className={`embedding-3d-point ${point.variant}`}
                cx={point.screenX}
                cy={point.screenY}
                r={point.radius}
              />
            </g>
          ))}
          {currentProjectedPoint ? (
            <g
              className="embedding-3d-point-group current"
              key={currentProjectedPoint.id}
              opacity={currentProjectedPoint.opacity}
              onMouseEnter={() => setHoveredPointId(currentProjectedPoint.id)}
              onMouseLeave={() => setHoveredPointId(null)}
            >
              <polygon
                className="embedding-3d-current-star-halo"
                points={buildStarPolygonPoints({
                  centerX: currentProjectedPoint.screenX,
                  centerY: currentProjectedPoint.screenY,
                  outerRadius: currentProjectedPoint.radius + 4.1,
                  innerRadius: currentProjectedPoint.radius + 1.1,
                })}
              />
              <polygon
                className="embedding-3d-current-star"
                points={buildStarPolygonPoints({
                  centerX: currentProjectedPoint.screenX,
                  centerY: currentProjectedPoint.screenY,
                  outerRadius: currentProjectedPoint.radius + 2.3,
                  innerRadius: currentProjectedPoint.radius * 0.82,
                })}
              />
            </g>
          ) : null}
        </svg>
        {hoveredPoint ? <PointTooltip point={hoveredPoint} /> : null}
      </div>
    </div>
  );
}

function EmbeddingMapExplorer({ points }: { points: DemoEmbeddingPoint[] }) {
  return (
    <div className="dashboard-embedding-panel">
      <div className="dashboard-embedding-toolbar" aria-label="Embedding map view mode">
        <div>
          <strong>Embedding projection studio</strong>
          <span>PLS1 risk axis와 semantic residual UMAP을 결합해 위험도 순서와 의미적 이웃을 함께 봅니다.</span>
        </div>
        <ClusterLegend />
      </div>
      <div className="dashboard-embedding-views">
        <section className="dashboard-embedding-view-card is-2d">
          <div className="dashboard-embedding-view-head">
            <strong>2D density slice</strong>
            <span>PLS1 risk x residual UMAP</span>
          </div>
          <EmbeddingMap points={points} />
        </section>
        <section className="dashboard-embedding-view-card is-3d">
          <div className="dashboard-embedding-view-head">
            <strong>3D orbit field</strong>
            <span>Risk axis + residual depth</span>
          </div>
          <EmbeddingMap3D points={points} />
        </section>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function SellerObservationCard({
  listingTitle,
  sellerName,
  priceText,
  trustSignals,
  className,
}: {
  listingTitle: string;
  sellerName: string;
  priceText: string;
  trustSignals: DashboardModel["sellerObservation"]["trustSignals"];
  className?: string;
}) {
  return (
    <article className={className ? `dashboard-card ${className}` : "dashboard-card dashboard-col-12"}>
      <header className="dashboard-card-header">
        <div>
          <h3>현재 거래</h3>
          <p>현재 스캔에 포함된 판매자, 가격, 신뢰지표를 한 번에 확인합니다.</p>
        </div>
        <span className="dashboard-pill is-warning">Captured</span>
      </header>
      <div className="dashboard-card-body">
        <div className="dashboard-observation-grid">
          <div className="dashboard-observation-item dashboard-observation-item-full">
            <span>제목</span>
            <strong>{listingTitle}</strong>
          </div>
          <div className="dashboard-observation-item">
            <span>판매자</span>
            <strong>{sellerName}</strong>
          </div>
          <div className="dashboard-observation-item">
            <span>가격</span>
            <strong>{priceText}</strong>
          </div>
        </div>
        <div className="dashboard-observation-signals">
          <span>신뢰 지표</span>
          {trustSignals.length ? (
            <ul
              className="dashboard-signal-list"
              style={{
                gridTemplateColumns: `repeat(${Math.min(Math.max(trustSignals.length, 1), 4)}, minmax(0, 1fr))`,
              }}
            >
              {trustSignals.map((signal) => (
                <li key={`${signal.key}-${signal.value}`}>
                  <strong>{signal.label}</strong>
                  <p>{signal.value}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dashboard-muted-copy">현재 스캔 payload에 포함된 신뢰지표는 없습니다.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function ExternalLookupCard({
  dashboard,
  className,
}: {
  dashboard: DashboardModel;
  className?: string;
}) {
  return (
    <article className={className ? `dashboard-card dashboard-external-card ${className}` : "dashboard-card dashboard-col-12 dashboard-external-card"}>
      <header className="dashboard-card-header">
        <div>
          <h3>External verification</h3>
          <p>경찰청과 더치트 조회 결과를 scan 결과와 함께 묶어 보여줍니다.</p>
        </div>
        <span className="dashboard-pill is-neutral">{dashboard.externalLookups.length} checks</span>
      </header>
      <div className="dashboard-card-body">
        {dashboard.externalLookups.length ? (
          <div className="dashboard-external-grid">
            {dashboard.externalLookups.map((lookup) => (
              <a
                className={`dashboard-external-row ${getToneClass(lookup.tone)}`}
                href={lookup.sourceUrl}
                key={`${lookup.title}-${lookup.keyword}-${lookup.statusLabel}`}
                rel="noreferrer"
                target="_blank"
              >
                <div className="dashboard-external-row-head">
                  <strong>{lookup.title}</strong>
                  <span className={`dashboard-pill ${getToneClass(lookup.tone)}`}>{lookup.statusLabel}</span>
                </div>
                <p>{lookup.message}</p>
                <small>{lookup.keyword}</small>
              </a>
            ))}
          </div>
        ) : (
          <p className="dashboard-muted-copy">
            현재 scan 응답에는 외부 조회 결과가 없습니다. 계좌번호나 010 전화번호 후보가 잡히면 이 카드에 결과가 표시됩니다.
          </p>
        )}
      </div>
    </article>
  );
}

function NarrativeCard({ title, sentences }: { title: string; sentences: string[] }) {
  return (
    <article className="dashboard-card dashboard-col-6">
      <header className="dashboard-card-header">
        <div>
          <h3>{title}</h3>
        </div>
      </header>
      <div className="dashboard-card-body">
        <ul className="dashboard-brief-list">
          {sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function SellerContextReportCard({
  error,
  isLoading,
  profileUrl,
  report,
  sellerName,
}: {
  error: string | null;
  isLoading: boolean;
  profileUrl: string | null;
  report: SellerContextReportResponse | null;
  sellerName: string;
}) {
  const titleName = report?.seller_name ?? sellerName ?? "unknown";
  const levelLabel = report?.seller_context_level ?? (profileUrl ? "loading" : "no profile");
  const positiveSignals = report?.positive_profile_signals ?? [];
  const riskSignals = report?.current_listing_risk_signals ?? [];

  return (
    <article className="dashboard-card dashboard-col-12 dashboard-seller-report-card">
      <header className="dashboard-card-header">
        <div>
          <h3>{`판매자: ${titleName} 분석글`}</h3>
          <p>현재 상품 위험도와 판매자 프로필의 공개 거래 이력을 함께 비교합니다.</p>
        </div>
        <span className={`dashboard-pill ${report?.seller_context_level === "high_risk" ? "is-danger" : "is-warning"}`}>
          {levelLabel}
        </span>
      </header>
      <div className="dashboard-card-body dashboard-seller-report-scroll">
        {!profileUrl ? (
          <p className="dashboard-muted-copy">
            이 scan에는 자동 추출된 판매자 프로필 URL이 없습니다. 중고나라 또는 번개장터 상품 페이지에서 다시 scan하면 자동 분석을 시도합니다.
          </p>
        ) : isLoading ? (
          <p className="dashboard-muted-copy">판매자 프로필을 가져와서 Gemini 분석글을 작성하는 중입니다.</p>
        ) : error ? (
          <div className="dashboard-seller-report-section">
            <strong>판매자 분석을 불러오지 못했습니다</strong>
            <p>{error}</p>
            <a className="dashboard-link" href={profileUrl} rel="noreferrer" target="_blank">
              판매자 프로필 열기
            </a>
          </div>
        ) : report ? (
          <>
            <div className="dashboard-seller-report-summary">
              <div>
                <span>Context score</span>
                <strong>{formatPercent(report.seller_context_score)}</strong>
              </div>
              <div>
                <span>Pattern</span>
                <strong>{report.pattern_consistency}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>{report.source}</strong>
              </div>
            </div>

            <div className="dashboard-seller-report-section">
              <strong>요약</strong>
              <p>{report.summary}</p>
            </div>

            <div className="dashboard-seller-report-section">
              <strong>현재 글과 기존 판매 양상 비교</strong>
              <p>{report.pattern_shift_explanation}</p>
            </div>

            <div className="dashboard-seller-report-section">
              <strong>권장 행동</strong>
              <p>{report.recommendation}</p>
            </div>

            {positiveSignals.length ? (
              <div className="dashboard-seller-report-section">
                <strong>긍정적인 프로필 신호</strong>
                <div className="dashboard-chip-row">
                  {positiveSignals.map((signal) => (
                    <span className="dashboard-pill is-ok" key={signal}>{signal}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {riskSignals.length ? (
              <div className="dashboard-seller-report-section">
                <strong>현재 상품 위험 신호</strong>
                <ul className="dashboard-brief-list">
                  {riskSignals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="dashboard-seller-report-section">
              <strong>판매자 프로필</strong>
              <a className="dashboard-link" href={profileUrl} rel="noreferrer" target="_blank">
                {profileUrl}
              </a>
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}

function buildSignalRowsFromDashboard(dashboard: DashboardModel): typeof SIGNAL_ROWS {
  const matchedRows = dashboard.reasons.slice(0, 4).map((reason) => ({
    source: reason.label,
    status: "Matched" as const,
    location: "현재 분석 결과",
    excerpt: reason.label,
    detail: reason.value,
  }));

  return matchedRows.length > 0 ? matchedRows : SIGNAL_ROWS;
}

function ShellActionRow({ view }: { view: ReportView }) {
  const meta = topActionMeta(view);

  return (
    <div className="dashboard-actions">
      <div>
        <div className="dashboard-eyebrow">{meta.pill}</div>
        <h1>{meta.title}</h1>
        <p>{meta.copy}</p>
      </div>
    </div>
  );
}

export function App() {
  const initialRoute = getCurrentRoute();
  const [route, setRoute] = useState(initialRoute);
  const [scanResult, setScanResult] = useState<ScanResultResponse | null>(null);
  const [pipelineDebug, setPipelineDebug] = useState<PipelineExchangeResponse | null>(null);
  const [caseRiskMap, setCaseRiskMap] = useState<RiskMapResponse | null>(null);
  const [sellerContextReport, setSellerContextReport] = useState<SellerContextReportResponse | null>(null);
  const [sellerContextError, setSellerContextError] = useState<string | null>(null);
  const [isSellerContextLoading, setIsSellerContextLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>(() => loadReportUserProfile());
  const [profileSaveStatus, setProfileSaveStatus] = useState<ProfileSaveStatus>("자동 저장");

  useEffect(() => {
    const syncRoute = () => {
      const nextRoute = getCurrentRoute();
      setRoute((currentRoute) => {
        if (
          shouldRefreshReportData(currentRoute, nextRoute) &&
          currentRoute.scanId !== nextRoute.scanId &&
          nextRoute.view === "settings"
        ) {
          setError(null);
          setScanResult(null);
          setPipelineDebug(null);
          setCaseRiskMap(null);
          setSellerContextReport(null);
          setSellerContextError(null);
          setIsSellerContextLoading(false);
        }
        return nextRoute;
      });
    };

    syncRoute();
    window.addEventListener("hashchange", syncRoute);

    return () => {
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (route.view === "settings" || !route.scanId) {
      setScanResult(null);
      setPipelineDebug(null);
      setCaseRiskMap(null);
      setSellerContextReport(null);
      setSellerContextError(null);
      setIsSellerContextLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const scanId = route.scanId;

    const load = async () => {
      setError(null);
      setScanResult(null);
      setPipelineDebug(null);
      setCaseRiskMap(null);
      setSellerContextReport(null);
      setSellerContextError(null);
      setIsSellerContextLoading(false);

      try {
        const sampleContext = getSampleScanContext(scanId);
        if (sampleContext) {
          if (cancelled) {
            return;
          }

          setScanResult(sampleContext.scanResult);
          setPipelineDebug(sampleContext.pipelineDebug);
          setCaseRiskMap(null);
          return;
        }

        const [result, debug] = await Promise.all([
          pollScanResult(scanId),
          getPipelineDebug(API_BASE_URL, scanId),
        ]);

        if (cancelled) {
          return;
        }

        setScanResult(result);
        setPipelineDebug(debug);
        // Keep the legacy /cases/umap code available, but prefer the risk-space map only.
        void getCaseRiskMap(API_BASE_URL, {
          dim: 3,
          mode: "embedding",
          reducer: "umap",
          projection: "pls7_umap",
          scanId,
        })
          .then((riskMap) => {
            if (!cancelled) {
              setCaseRiskMap(riskMap);
            }
          })
          .catch(() => {
            if (!cancelled) {
              setCaseRiskMap(null);
            }
          });
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : "Unknown dashboard error");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [route.scanId, route.view]);

  useEffect(() => {
    const profileUrl = pipelineDebug?.outbound_payload.seller.profile_url ?? null;
    if (route.view !== "reports" || !scanResult || scanResult.status !== "completed" || !profileUrl) {
      setSellerContextReport(null);
      setSellerContextError(null);
      setIsSellerContextLoading(false);
      return;
    }

    let cancelled = false;
    setSellerContextReport(null);
    setSellerContextError(null);
    setIsSellerContextLoading(true);

    const load = async () => {
      try {
        const report = await createSellerContextReport(API_BASE_URL, scanResult.scan_id, profileUrl);
        if (!cancelled) {
          setSellerContextReport(report);
        }
      } catch (nextError) {
        if (!cancelled) {
          setSellerContextError(nextError instanceof Error ? nextError.message : "Unknown seller report error");
        }
      } finally {
        if (!cancelled) {
          setIsSellerContextLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [pipelineDebug, route.view, scanResult]);

  const dashboard = useMemo(() => {
    if (!scanResult) {
      return null;
    }

    return buildDashboardModel({
      scanResult,
      pipelineDebug,
      caseUmap: null,
      caseRiskMap,
    });
  }, [caseRiskMap, pipelineDebug, scanResult]);
  const reportBrief = useMemo(() => {
    if (!scanResult || !dashboard) {
      return null;
    }

    return buildReportBrief({
      scanResult,
      dashboard,
      pipelineDebug,
    });
  }, [dashboard, pipelineDebug, scanResult]);
  const dashboardEmbedding = useMemo(
    () =>
      buildDemoEmbeddingResult({
        scanId: "dashboard-demo",
        riskLevel: "high",
        highlightCount: 5,
      }),
    [],
  );

  const mainHref = buildRouteHref("dashboard", route.scanId);
  const reportsHref = buildRouteHref("reports", route.scanId);
  const settingsHref = buildRouteHref("settings");
  const hasActiveScanContext = route.view !== "settings" && Boolean(route.scanId);
  const isScanContextLoading = hasActiveScanContext && !error && (!scanResult || !pipelineDebug);

  const persistUserProfile = (nextProfile: UserProfile) => {
    setUserProfile(nextProfile);
    saveReportUserProfile(nextProfile);
    setProfileSaveStatus("저장됨");
    window.setTimeout(() => {
      setProfileSaveStatus("자동 저장");
    }, 1200);
  };

  const handleAgeChange = (value: string) => {
    const nextAge = value.trim() === "" ? null : Number.parseInt(value, 10);
    persistUserProfile({
      ...userProfile,
      age: Number.isFinite(nextAge) ? nextAge : null,
    });
  };

  const handleExperienceChange = (level: UserTradeExperienceLevel) => {
    persistUserProfile({
      ...userProfile,
      trade_experience_level: level,
    });
  };

  const renderDashboardView = () => {
    const signalRows = dashboard ? buildSignalRowsFromDashboard(dashboard) : SIGNAL_ROWS;

    return (
      <>
        <ShellActionRow view="dashboard" />

        {route.scanId ? (
          isScanContextLoading ? (
            <section className="dashboard-card dashboard-empty">
              <div className="dashboard-card-body">
                <h3>대시보드를 불러오는 중입니다</h3>
                <p>현재 선택된 scan의 카드 데이터를 가져오고 있습니다.</p>
              </div>
            </section>
          ) : error ? (
            <section className="dashboard-card dashboard-empty">
              <div className="dashboard-card-body">
                <h3>불러오기에 실패했습니다</h3>
                <p>{error}</p>
              </div>
            </section>
          ) : dashboard && scanResult ? (
            <section className="dashboard-grid">
              <article className="dashboard-card dashboard-col-12 dashboard-report-hero">
                <div className="dashboard-card-pad">
                  <div className="dashboard-report-head">
                    <div>
                      <div className="dashboard-micro-label">{dashboard.hero.eyebrow}</div>
                      <h2>{dashboard.hero.title}</h2>
                      <p>{dashboard.hero.summary}</p>
                    </div>
                    <div className="dashboard-report-score">
                      <span>risk score</span>
                      <strong>{formatPercent(scanResult.risk_score ?? null)}</strong>
                      <small>{scanResult.similar_cases.length} similar cases</small>
                    </div>
                  </div>
                </div>
              </article>

              <OverviewCard
                description="스캔 품질, 보호된 사용자 규모, 수동 검토량을 하나로 묶어 먼저 읽도록 구성했습니다."
                items={dashboard.overview.items}
                title={dashboard.overview.label}
              />

              <SellerObservationCard
                className="dashboard-col-12"
                listingTitle={dashboard.sellerObservation.listingTitle}
                priceText={dashboard.sellerObservation.priceText}
                sellerName={dashboard.sellerObservation.sellerName}
                trustSignals={dashboard.sellerObservation.trustSignals}
              />

              <article className="dashboard-card dashboard-col-12 dashboard-embedding-card">
                <header className="dashboard-card-header">
                  <div>
                    <h3>{dashboard.embedding.title}</h3>
                    <p>{dashboard.embedding.description}</p>
                  </div>
                  <span className="dashboard-pill is-warning">{dashboard.embedding.pipeline}</span>
                </header>
                <div className="dashboard-card-body">
                  <div className="dashboard-embedding-summary-strip">
                    <div>
                      <span>nearest label group</span>
                      <strong>{dashboard.embedding.summary.nearestCluster}</strong>
                    </div>
                  </div>
                  <EmbeddingMapExplorer points={dashboard.embedding.points} />
                </div>
              </article>

              <ExternalLookupCard dashboard={dashboard} />

              <article className="dashboard-card dashboard-col-12">
                <header className="dashboard-card-header">
                  <div>
                    <h3>Top signals</h3>
                    <p>현재 분석에서 실제로 잡힌 핵심 신호와, 각 신호가 어떤 이유로 중요해졌는지 정리합니다.</p>
                  </div>
                  <span className="dashboard-pill is-warning">Active scan</span>
                </header>
                <div className="dashboard-card-body dashboard-table-wrap">
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>Flag</th>
                        <th>Location</th>
                        <th>Excerpt</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signalRows.map((row) => (
                        <tr key={row.source}>
                          <td>{row.source}</td>
                          <td><span className={signalPillClass(row.status)}>{row.status}</span></td>
                          <td>{row.location}</td>
                          <td>{row.excerpt}</td>
                          <td>{row.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="dashboard-card dashboard-col-12">
                <header className="dashboard-card-header">
                  <div>
                    <h3>Next actions</h3>
                    <p>지금 바로 확인하거나 멈춰야 할 다음 행동입니다.</p>
                  </div>
                </header>
                <div className="dashboard-card-body">
                  <ul className="dashboard-detail-list">
                    {dashboard.actions.map((action) => (
                      <li key={`${action.label}-${action.value}`}>
                        <strong>{action.label}</strong>
                        <p>{action.value}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            </section>
          ) : null
        ) : (
          <section className="dashboard-grid">
            <OverviewCard
              description="최근 보호 지표를 먼저 보고, 그다음 어떤 경고 신호가 현재 게시글에서 발견됐는지 이어서 확인합니다."
              items={DASHBOARD_OVERVIEW_ITEMS}
              title="Risk overview"
            />

            <article className="dashboard-card dashboard-col-12">
              <header className="dashboard-card-header">
                <div>
                  <h3>Top signals</h3>
                  <p>현재 데모 게시글에서 실제로 감지된 신호와 아직 찾지 못한 항목을 함께 보여줍니다.</p>
                </div>
                <span className="dashboard-pill is-warning">Current post</span>
              </header>
              <div className="dashboard-card-body dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th>Flag</th>
                      <th>Location</th>
                      <th>Excerpt</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SIGNAL_ROWS.map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td><span className={signalPillClass(row.status)}>{row.status}</span></td>
                        <td>{row.location}</td>
                        <td>{row.excerpt}</td>
                        <td>{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="dashboard-card dashboard-col-12 dashboard-embedding-card">
              <header className="dashboard-card-header">
                <div>
                  <h3>Embedding map</h3>
                  <p>원본 임베딩을 PLS7 risk-aware latent space로 변환한 뒤 unsupervised UMAP으로 축소해 2D와 3D에서 유사 사례 라벨 그룹을 함께 보여줍니다.</p>
                </div>
                <span className="dashboard-pill is-neutral">{dashboardEmbedding.pipeline}</span>
              </header>
              <div className="dashboard-card-body">
                <div className="dashboard-embedding-summary-strip">
                  <div>
                    <span>nearest label group</span>
                    <strong>{dashboardEmbedding.summary.nearestCluster}</strong>
                  </div>
                </div>
                <EmbeddingMapExplorer points={dashboardEmbedding.points} />
              </div>
            </article>

            <article className="dashboard-card dashboard-col-12">
              <header className="dashboard-card-header">
                <div>
                  <h3>Recent scans</h3>
                  <p>최근 스캔된 거래 요약</p>
                </div>
                <a className="dashboard-link" href={reportsHref}>View reports</a>
              </header>
              <div className="dashboard-card-body">
                <div className="dashboard-list">
                  {RECENT_SCANS.map((scan) => (
                    <a className="dashboard-list-row" href={`#/reports/${scan.id}`} key={scan.id}>
                      <div>
                        <strong>{scan.title}</strong>
                        <p>{scan.summary}</p>
                      </div>
                      <span className={`dashboard-pill ${getToneClass(scan.tone)}`}>{toneLabel(scan.tone)}</span>
                    </a>
                  ))}
                </div>
              </div>
            </article>
          </section>
        )}
      </>
    );
  };

  const renderReportsView = () => {
    const sellerProfileUrl = pipelineDebug?.outbound_payload.seller.profile_url ?? null;
    const sellerName = pipelineDebug?.outbound_payload.seller.nickname ?? "unknown";

    return (
      <>
        <ShellActionRow view="reports" />

        {!route.scanId ? (
          <section className="dashboard-grid">
            <article className="dashboard-card dashboard-col-12">
              <header className="dashboard-card-header">
                <div>
                  <h3>Recent reports</h3>
                  <p>최근 스캔 결과를 열어 상세 분석으로 이동합니다. 실제 서비스에서는 사용자별 저장 report 목록이 이 자리를 대체합니다.</p>
                </div>
              </header>
              <div className="dashboard-card-body">
                <div className="dashboard-list">
                  {RECENT_SCANS.map((scan) => (
                    <a className="dashboard-list-row" href={`#/reports/${scan.id}`} key={scan.id}>
                      <div>
                        <strong>{scan.title}</strong>
                        <p>{scan.summary}</p>
                      </div>
                      <span className={`dashboard-pill ${getToneClass(scan.tone)}`}>{toneLabel(scan.tone)}</span>
                    </a>
                  ))}
                </div>
              </div>
            </article>
          </section>
        ) : isScanContextLoading ? (
          <section className="dashboard-card dashboard-empty">
            <div className="dashboard-card-body">
              <h3>리포트를 불러오는 중입니다</h3>
              <p>선택한 scan 결과와 근거 데이터를 묶어 핵심 문장으로 정리하고 있습니다.</p>
            </div>
          </section>
        ) : error ? (
          <section className="dashboard-card dashboard-empty">
            <div className="dashboard-card-body">
              <h3>불러오기에 실패했습니다</h3>
              <p>{error}</p>
            </div>
          </section>
        ) : dashboard && scanResult && reportBrief ? (
          <section className="dashboard-grid">
            <article className="dashboard-card dashboard-col-12 dashboard-report-hero">
              <div className="dashboard-card-pad">
                <div className="dashboard-report-head">
                  <div>
                    <div className="dashboard-micro-label">{dashboard.hero.eyebrow}</div>
                    <h2>{dashboard.hero.title}</h2>
                    <p>{dashboard.hero.summary}</p>
                  </div>
                  <div className="dashboard-report-score">
                    <span>risk score</span>
                    <strong>{formatPercent(scanResult.risk_score ?? null)}</strong>
                    <small>{scanResult.similar_cases.length} similar cases</small>
                  </div>
                </div>
              </div>
            </article>

            {reportBrief.sections.map((section) => (
              <NarrativeCard key={section.title} sentences={section.sentences} title={section.title} />
            ))}

            <SellerContextReportCard
              error={sellerContextError}
              isLoading={isSellerContextLoading}
              profileUrl={sellerProfileUrl}
              report={sellerContextReport}
              sellerName={sellerName}
            />
          </section>
        ) : null}
      </>
    );
  };

  const renderSettingsView = () => (
    <>
      <ShellActionRow view="settings" />

      <section className="dashboard-grid dashboard-settings-profile-only">
        <article className="dashboard-card dashboard-col-6 dashboard-settings-profile-card">
          <header className="dashboard-card-header">
            <div>
              <h3>사용자 정보 설정</h3>
              <p>스캔 결과를 사용자 상황에 맞춰 더 보수적으로 해석하기 위한 최소 정보입니다.</p>
            </div>
            <span className={`dashboard-pill ${profileSaveStatus === "저장됨" ? "is-ok" : "is-neutral"}`}>
              {profileSaveStatus}
            </span>
          </header>
          <div className="dashboard-card-body">
            <div className="dashboard-form">
              <label>
                나이
                <input
                  inputMode="numeric"
                  max={120}
                  min={0}
                  onChange={(event) => handleAgeChange(event.target.value)}
                  placeholder="예: 24"
                  type="number"
                  value={userProfile.age ?? ""}
                />
              </label>

              <div className="dashboard-field-group">
                <span>중고거래 경험</span>
                <div className="dashboard-choice-grid" role="radiogroup" aria-label="중고거래 경험">
                  {EXPERIENCE_LEVELS.map((level) => (
                    <button
                      aria-checked={userProfile.trade_experience_level === level}
                      className={`dashboard-choice ${userProfile.trade_experience_level === level ? "is-active" : ""}`}
                      key={level}
                      onClick={() => handleExperienceChange(level)}
                      role="radio"
                      type="button"
                    >
                      {EXPERIENCE_LABELS[level]}
                    </button>
                  ))}
                </div>
              </div>

              <p className="dashboard-helper-copy">
                입력한 나이와 거래 경험은 맞춤형 위험도 계산에 활용됩니다.
              </p>
            </div>
          </div>
        </article>
      </section>
    </>
  );

  const reportsIsActive = route.view === "reports";
  const showSidebarAccount = route.view !== "dashboard";

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-top">
          <div className="dashboard-logo">
            <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <path d="M31.956 14.8C31.372 6.92 25.08.628 17.2.044V5.76a9.04 9.04 0 0 0 9.04 9.04h5.716ZM14.8 26.24v5.716C6.92 31.372.63 25.08.044 17.2H5.76a9.04 9.04 0 0 1 9.04 9.04Zm11.44-9.04h5.716c-.584 7.88-6.876 14.172-14.756 14.756V26.24a9.04 9.04 0 0 1 9.04-9.04ZM.044 14.8C.63 6.92 6.92.628 14.8.044V5.76a9.04 9.04 0 0 1-9.04 9.04H.044Z" />
            </svg>
          </div>
        </div>

        <div className="dashboard-sidebar-groups">
          <section className="dashboard-sidebar-group">
            <h2>Pages</h2>
            <div className="dashboard-sidebar-item is-group is-active">
              <div className="dashboard-sidebar-link">
                <span>{iconSvg("M10 2a8 8 0 108 8 8 8 0 00-8-8Zm1 4.1V10l3 1.8-.7 1.2L10 11V6.1Z")}</span>
                <strong>Safety center</strong>
              </div>
              <div className="dashboard-sidebar-subnav">
                <a className={route.view === "dashboard" ? "is-active" : ""} href={mainHref}>Dashboard</a>
                <a className={reportsIsActive ? "is-active" : ""} href={reportsHref}>Reports</a>
                <a className={route.view === "settings" ? "is-active" : ""} href={settingsHref}>Settings</a>
              </div>
            </div>
          </section>

          <section className="dashboard-sidebar-group">
            <h2>Workspace</h2>
            <a className="dashboard-sidebar-link" href={DEMO_PAGE_URL}>
              <span>{iconSvg("M3 5h14v10H3zM6 8h8v1H6zm0 3h5v1H6z")}</span>
              <strong>Demo Page · 상품</strong>
            </a>
            <a className="dashboard-sidebar-link" href={DEMO_JOONGNA_CHAT_URL}>
              <span>{iconSvg("M4 5h12v8H8l-4 3V5Zm2 2v1h8V7H6Zm0 3v1h5v-1H6Z")}</span>
              <strong>Demo Page · 중고나라 채팅</strong>
            </a>
            <a className="dashboard-sidebar-link" href={DEMO_BUNJANG_CHAT_URL}>
              <span>{iconSvg("M4 5h12v8H8l-4 3V5Zm2 2v1h8V7H6Zm0 3v1h5v-1H6Z")}</span>
              <strong>Demo Page · 번개장터 채팅</strong>
            </a>
            <a className="dashboard-sidebar-link" href={HEALTHCHECK_URL} rel="noreferrer" target="_blank">
              <span>{iconSvg("M10 2l6 3.5v4c0 4.1-2.5 7-6 8.5-3.5-1.5-6-4.4-6-8.5v-4L10 2Zm-1 9h2V6H9v5Zm0 3h2v-2H9v2Z")}</span>
              <strong>Backend health</strong>
            </a>
          </section>
        </div>

        {showSidebarAccount ? (
          <div className="dashboard-sidebar-footer">
            <div className="dashboard-sidebar-profile">
              <div className="dashboard-avatar">S</div>
              <div>
                <strong>safe-ticket</strong>
                <span>Scan workspace</span>
              </div>
            </div>
          </div>
        ) : null}
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-actions">
            <IconButton>{iconSvg("M9 3a6 6 0 104.2 10.2l3.3 3.3 1.1-1.1-3.3-3.3A6 6 0 009 3Zm0 1.6a4.4 4.4 0 110 8.8 4.4 4.4 0 010-8.8Z")}</IconButton>
            <IconButton>{iconSvg("M10 3a4 4 0 00-4 4v2.2L4.9 11v1.1h10.2V11L14 9.2V7a4 4 0 00-4-4Zm0 14a2 2 0 001.8-1.2H8.2A2 2 0 0010 17Z")}</IconButton>
            <IconButton>{iconSvg("M10 6.2A3.8 3.8 0 1013.8 10 3.8 3.8 0 0010 6.2Zm0-4.2 1 1.8 2-.1-.1 2 1.8 1-1.8 1 .1 2-2-.1-1 1.8-1-1.8-2 .1.1-2-1.8-1 1.8-1-.1-2 2 .1Z")}</IconButton>
            <div className="dashboard-topbar-divider" />
            <button className="dashboard-userchip" type="button">
              <span className="dashboard-userchip-dot" />
              <strong>safe-ticket</strong>
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          {route.view === "dashboard" ? renderDashboardView() : null}
          {route.view === "reports" ? renderReportsView() : null}
          {route.view === "settings" ? renderSettingsView() : null}
        </main>
      </div>
    </div>
  );
}
