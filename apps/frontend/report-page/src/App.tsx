import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";

import { getSafeTicketApiBaseUrl, getSafeTicketFrontendBaseUrl } from "../../shared/runtime-config";
import { getCaseUmap, getPipelineDebug, getScan } from "../../shared/scan-api";
import type { CaseUmapResponse, PipelineExchangeResponse, ScanResultResponse } from "../../shared/types";
import { buildDashboardModel, type DashboardModel } from "./lib/dashboard-model";
import { buildDemoEmbeddingResult, type DemoEmbeddingPoint } from "./lib/demo-embedding";
import {
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
const HEALTHCHECK_URL = `${API_BASE_URL}/api/v1/health/live`;

type ProfileMode = "general" | "newcomer" | "cautious";
type Tone = "danger" | "warning" | "ok" | "neutral";

type PreferencesState = {
  emailAlerts: boolean;
  autoOpenReport: boolean;
  loginRequired: boolean;
};

type AccountState = {
  name: string;
  email: string;
};

type SignalFlag = "Matched" | "Review" | "Not found";

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
      copy: "계정, 로그인, 보호 프로필과 기본 해석 강도를 조정합니다.",
      pill: "Account",
    };
  }

  if (view === "reports") {
    return {
      title: "Reports",
      copy: "scan 단위 핵심 해설 페이지입니다. 길게 늘어놓지 않고, 왜 문제가 됐는지와 어떤 대응이 필요한지만 문장형으로 정리합니다.",
      pill: "Narrative",
    };
  }

  return {
    title: "Dashboard",
    copy: "현재 scan 기준으로 어떤 신호가 잡혔는지, 임베딩 공간에서 어디에 놓이는지, 판매자와 원문 근거가 어떻게 연결되는지 카드 중심으로 보여주는 분석 대시보드입니다.",
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
        <text className="embedding-axis-label" x="90" y="88">UMAP 1</text>
        <text className="embedding-axis-label is-y" x="12" y="13">UMAP 2</text>
        {points.map((point) => (
          <g key={point.id}>
            {point.variant === "current" ? (
              <circle className="embedding-current-ring" cx={point.x} cy={point.y} r="4.7" />
            ) : null}
            <circle
              className={`embedding-point ${point.variant}`}
              cx={point.x}
              cy={point.y}
              r={point.variant === "current" ? 2.65 : 1.2}
            />
          </g>
        ))}
        {currentPoint ? (
          <>
            <line className="embedding-current-guide" x1={currentPoint.x} x2={currentPoint.x} y1="8" y2="92" />
            <line className="embedding-current-guide" x1="8" x2="94" y1={currentPoint.y} y2={currentPoint.y} />
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
      <span>{point.variant} / z {point.z.toFixed(1)}</span>
    </div>
  );
}

function EmbeddingMap3D({ points }: { points: DemoEmbeddingPoint[] }) {
  const [camera, setCamera] = useState({ pitch: -31, yaw: 42, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; pitch: number; yaw: number } | null>(null);
  const projectedPoints = useMemo(() => projectEmbeddingPoints3D(points, camera), [camera, points]);
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
          {projectedPoints.map((point) => (
            <g
              className={`embedding-3d-point-group ${point.variant}`}
              key={point.id}
              opacity={point.opacity}
              onMouseEnter={() => setHoveredPointId(point.id)}
              onMouseLeave={() => setHoveredPointId(null)}
            >
              {point.variant === "current" ? (
                <circle className="embedding-3d-current-halo" cx={point.screenX} cy={point.screenY} r={point.radius + 2.7} />
              ) : null}
              <circle
                className={`embedding-3d-point ${point.variant}`}
                cx={point.screenX}
                cy={point.screenY}
                r={point.radius}
              />
            </g>
          ))}
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
          <span>위험도 순서형 target으로 완만하게 조정한 Supervised UMAP(2/3)을 분석합니다.</span>
        </div>
        <ClusterLegend />
      </div>
      <div className="dashboard-embedding-views">
        <section className="dashboard-embedding-view-card is-2d">
          <div className="dashboard-embedding-view-head">
            <strong>2D density slice</strong>
            <span>Supervised UMAP(2)</span>
          </div>
          <EmbeddingMap points={points} />
        </section>
        <section className="dashboard-embedding-view-card is-3d">
          <div className="dashboard-embedding-view-head">
            <strong>3D orbit field</strong>
            <span>Supervised UMAP(3)</span>
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

function formatDistance(value: number | undefined) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

function SellerObservationCard({
  sellerName,
  primaryAlias,
  accountNumber,
  recentFraudCases,
  observedAliases,
}: {
  sellerName: string;
  primaryAlias: string;
  accountNumber: string;
  recentFraudCases: number;
  observedAliases: string[];
}) {
  return (
    <article className="dashboard-card dashboard-col-4">
      <header className="dashboard-card-header">
        <div>
          <h3>판매자 / 작성자 관찰 정보</h3>
          <p>닉네임, 계좌, 최근 관찰 사례를 하나의 카드로 묶었습니다.</p>
        </div>
        <span className="dashboard-pill is-warning">Observed</span>
      </header>
      <div className="dashboard-card-body">
        <div className="dashboard-observation-grid">
          <div className="dashboard-observation-item">
            <span>판매자 이름</span>
            <strong>{sellerName}</strong>
          </div>
          <div className="dashboard-observation-item">
            <span>주요 닉네임</span>
            <strong>{primaryAlias}</strong>
          </div>
          <div className="dashboard-observation-item">
            <span>계좌번호</span>
            <strong>{accountNumber}</strong>
          </div>
          <div className="dashboard-observation-item">
            <span>최근 사기 거래 내역</span>
            <strong>{recentFraudCases}건</strong>
          </div>
        </div>
        <div className="dashboard-chip-row">
          {observedAliases.map((alias) => (
            <span className="dashboard-pill is-neutral" key={alias}>
              {alias}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function ExternalLookupCard({ dashboard }: { dashboard: DashboardModel }) {
  return (
    <article className="dashboard-card dashboard-col-12 dashboard-external-card">
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

function ShellActionRow({
  view,
  addViewHref,
}: {
  view: ReportView;
  addViewHref: string;
}) {
  const meta = topActionMeta(view);

  return (
    <div className="dashboard-actions">
      <div>
        <div className="dashboard-eyebrow">{meta.pill}</div>
        <h1>{meta.title}</h1>
        <p>{meta.copy}</p>
      </div>

      <div className="dashboard-actions-right">
        <button className="dashboard-btn dashboard-btn-muted" type="button">
          {iconSvg("M3 4h14v2H3zM6 9h8v2H6zM8 14h4v2H8z")}
          <span>Filter</span>
        </button>
        <button className="dashboard-btn dashboard-btn-muted" type="button">
          {iconSvg("M5 2h1v2h8V2h1v2h2v13H3V4zm11 5H4v8h12z")}
          <span>Apr 13, 2026</span>
        </button>
        <a className="dashboard-btn dashboard-btn-primary" href={addViewHref}>
          {iconSvg("M10 4v12M4 10h12")}
          <span>Add View</span>
        </a>
      </div>
    </div>
  );
}

export function App() {
  const initialRoute = getCurrentRoute();
  const [route, setRoute] = useState(initialRoute);
  const [scanResult, setScanResult] = useState<ScanResultResponse | null>(null);
  const [pipelineDebug, setPipelineDebug] = useState<PipelineExchangeResponse | null>(null);
  const [caseUmap, setCaseUmap] = useState<CaseUmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileMode, setProfileMode] = useState<ProfileMode>("cautious");
  const [account, setAccount] = useState<AccountState | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [preferences, setPreferences] = useState<PreferencesState>({
    emailAlerts: true,
    autoOpenReport: true,
    loginRequired: false,
  });

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
          setCaseUmap(null);
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
      setCaseUmap(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const scanId = route.scanId;

    const load = async () => {
      setError(null);
      setScanResult(null);
      setPipelineDebug(null);
      setCaseUmap(null);

      try {
        const [result, debug, umap] = await Promise.all([
          pollScanResult(scanId),
          getPipelineDebug(API_BASE_URL, scanId),
          getCaseUmap(API_BASE_URL, scanId).catch(() => null),
        ]);

        if (cancelled) {
          return;
        }

        setScanResult(result);
        setPipelineDebug(debug);
        setCaseUmap(umap);
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

  const dashboard = useMemo(() => {
    if (!scanResult) {
      return null;
    }

    return buildDashboardModel({
      scanResult,
      pipelineDebug,
      caseUmap,
    });
  }, [caseUmap, pipelineDebug, scanResult]);
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

  const profileSummary =
    profileMode === "newcomer"
      ? "거래 경험이 적은 사용자 기준으로 추가 입금 요청, 외부 메신저 이동, 계좌 재입력을 더 보수적으로 해석합니다."
      : profileMode === "cautious"
        ? "경고 민감도를 높게 잡아 거래 중단과 계좌 재확인을 우선 안내합니다."
        : "일반 사용자 기준으로 신호를 요약하고, 반복 패턴과 명시적 근거를 함께 보여줍니다.";

  const mainHref = buildRouteHref("dashboard", route.scanId);
  const reportsHref = buildRouteHref("reports", route.scanId);
  const settingsHref = buildRouteHref("settings");
  const hasActiveScanContext = route.view !== "settings" && Boolean(route.scanId);
  const isScanContextLoading = hasActiveScanContext && !error && (!scanResult || !pipelineDebug);

  const handleLoginSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccount({
      name: emailInput.trim().split("@")[0] || "safe-ticket user",
      email: emailInput.trim() || "demo@safe-ticket.local",
    });
  };

  const handleDemoAuth = (mode: "login" | "signup") => {
    setAccount({
      name: emailInput.trim().split("@")[0] || (mode === "signup" ? "new safe-ticket user" : "safe-ticket user"),
      email: emailInput.trim() || "demo@safe-ticket.local",
    });
  };

  const togglePreference = (key: keyof PreferencesState) => {
    setPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const renderDashboardView = () => {
    const outboundPayload = pipelineDebug?.outbound_payload;
    const signalRows = dashboard ? buildSignalRowsFromDashboard(dashboard) : SIGNAL_ROWS;

    return (
      <>
        <ShellActionRow addViewHref={reportsHref} view="dashboard" />

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

              <ExternalLookupCard dashboard={dashboard} />

              <article className="dashboard-card dashboard-col-8">
                <header className="dashboard-card-header">
                  <div>
                    <h3>Top signals</h3>
                    <p>현재 분석에서 실제로 flag가 선 문구와, 어느 지점에서 판단에 반영됐는지 보여줍니다.</p>
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
                    <div>
                      <span>fraud center</span>
                      <strong>{formatDistance(dashboard.embedding.summary.distances.fraud)}</strong>
                    </div>
                    <div>
                      <span>borderline center</span>
                      <strong>{formatDistance(dashboard.embedding.summary.distances.borderline)}</strong>
                    </div>
                    <div>
                      <span>safe center</span>
                      <strong>{formatDistance(dashboard.embedding.summary.distances.safe)}</strong>
                    </div>
                  </div>
                  <EmbeddingMapExplorer points={dashboard.embedding.points} />
                </div>
              </article>

              <SellerObservationCard
                accountNumber={dashboard.sellerObservation.accountNumber}
                observedAliases={dashboard.sellerObservation.observedAliases}
                primaryAlias={dashboard.sellerObservation.primaryAlias}
                recentFraudCases={dashboard.sellerObservation.recentFraudCases}
                sellerName={dashboard.sellerObservation.sellerName}
              />

              <article className="dashboard-card dashboard-col-4">
                <header className="dashboard-card-header">
                  <div>
                    <h3>Why flagged</h3>
                    <p>문제 이유</p>
                  </div>
                </header>
                <div className="dashboard-card-body">
                  <ul className="dashboard-detail-list">
                    {dashboard.reasons.map((reason) => (
                      <li key={`${reason.label}-${reason.value}`}>
                        <strong>{reason.label}</strong>
                        <p>{reason.value}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>

              <article className="dashboard-card dashboard-col-8">
                <header className="dashboard-card-header">
                  <div>
                    <h3>Next actions</h3>
                    <p>권장 확인 사항</p>
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

              <article className="dashboard-card dashboard-col-12">
                <header className="dashboard-card-header">
                  <div>
                    <h3>Source trace</h3>
                    <p>원문 / 판매자 정보</p>
                  </div>
                  <span className="dashboard-pill is-neutral">captured payload</span>
                </header>
                <div className="dashboard-card-body dashboard-source-grid">
                  <div className="dashboard-source-box">
                    <strong>원본 게시글</strong>
                    <p>{outboundPayload?.page_title}</p>
                    <small>{outboundPayload?.page_url}</small>
                  </div>
                  <div className="dashboard-source-box">
                    <strong>판매자</strong>
                    <p>{outboundPayload?.seller.nickname}</p>
                    <small>{outboundPayload?.seller.seller_id}</small>
                  </div>
                  <div className="dashboard-source-box dashboard-source-full">
                    <strong>수집된 본문 블록</strong>
                    <pre>{outboundPayload?.content_blocks.map((block) => block.text).join("\n\n")}</pre>
                  </div>
                </div>
              </article>
            </section>
          ) : null
        ) : (
          <section className="dashboard-grid">
            <OverviewCard
              description="최근 보호 지표를 하나의 카드에서 함께 보고, 어떤 축에서 검토가 필요한지 바로 읽도록 정리했습니다."
              items={DASHBOARD_OVERVIEW_ITEMS}
              title="Risk overview"
            />

            <article className="dashboard-card dashboard-col-8">
              <header className="dashboard-card-header">
                <div>
                  <h3>Top signals</h3>
                  <p>현재 데모 게시글에서 실제로 어디에 걸렸는지와, 아직 안 잡힌 항목을 함께 보여줍니다.</p>
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
                  <p>원본 임베딩을 PCA(50)와 supervised UMAP으로 축소한 뒤, 2D와 3D에서 유사 사례 라벨 그룹을 함께 보여줍니다.</p>
                </div>
                <span className="dashboard-pill is-neutral">{dashboardEmbedding.pipeline}</span>
              </header>
              <div className="dashboard-card-body">
                <div className="dashboard-embedding-summary-strip">
                  <div>
                    <span>nearest label group</span>
                    <strong>{dashboardEmbedding.summary.nearestCluster}</strong>
                  </div>
                  <div>
                    <span>fraud center</span>
                    <strong>{formatDistance(dashboardEmbedding.summary.distances.fraud)}</strong>
                  </div>
                  <div>
                    <span>borderline center</span>
                    <strong>{formatDistance(dashboardEmbedding.summary.distances.borderline)}</strong>
                  </div>
                  <div>
                    <span>safe center</span>
                    <strong>{formatDistance(dashboardEmbedding.summary.distances.safe)}</strong>
                  </div>
                </div>
                <EmbeddingMapExplorer points={dashboardEmbedding.points} />
              </div>
            </article>

            <article className="dashboard-card dashboard-col-4">
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
    const topHighlights = scanResult?.highlight_targets.slice(0, 3) ?? [];

    return (
      <>
        <ShellActionRow addViewHref={DEMO_PAGE_URL} view="reports" />

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
                <div className="dashboard-highlight-row">
                  {topHighlights.map((target) => (
                    <span className="dashboard-highlight-pill" key={`${target.matched_text}-${target.start}`}>
                      {target.matched_text}
                    </span>
                  ))}
                </div>
              </div>
            </article>

            {reportBrief.sections.map((section) => (
              <NarrativeCard key={section.title} sentences={section.sentences} title={section.title} />
            ))}

            <ExternalLookupCard dashboard={dashboard} />
          </section>
        ) : null}
      </>
    );
  };

  const renderSettingsView = () => (
    <>
      <ShellActionRow addViewHref={HEALTHCHECK_URL} view="settings" />

      {!account ? (
        <section className="dashboard-grid dashboard-settings-login-only">
          <article className="dashboard-card dashboard-col-6 dashboard-settings-auth-card">
            <header className="dashboard-card-header">
              <div>
                <h3>Account & login</h3>
                <p>실제 서비스처럼 먼저 계정 진입을 만들고, 로그인 이후에만 보호 설정을 노출합니다.</p>
              </div>
            </header>
            <div className="dashboard-card-body">
              <form className="dashboard-form" onSubmit={handleLoginSubmit}>
                <label>
                  아이디 또는 이메일
                  <input onChange={(event) => setEmailInput(event.target.value)} placeholder="safe-ticket@example.com" type="text" value={emailInput} />
                </label>
                <label>
                  비밀번호
                  <input onChange={(event) => setPasswordInput(event.target.value)} placeholder="••••••••" type="password" value={passwordInput} />
                </label>
                <div className="dashboard-auth-actions">
                  <button className="dashboard-btn dashboard-btn-primary" type="submit">로그인</button>
                  <button className="dashboard-btn dashboard-btn-muted" onClick={() => handleDemoAuth("signup")} type="button">회원가입</button>
                </div>
                <div className="dashboard-auth-links">
                  <button className="dashboard-link-button" type="button">아이디 찾기</button>
                  <button className="dashboard-link-button" type="button">비밀번호 찾기</button>
                </div>
              </form>
            </div>
          </article>
        </section>
      ) : (
        <section className="dashboard-grid">
          <article className="dashboard-card dashboard-col-6">
          <header className="dashboard-card-header">
            <div>
              <h3>Account & login</h3>
              <p>계정 및 로그인</p>
            </div>
            <span className={`dashboard-pill ${account ? "is-ok" : "is-neutral"}`}>
              {account ? "Logged in" : "Guest"}
            </span>
          </header>
          <div className="dashboard-card-body">
            <div className="dashboard-account-panel">
              <strong>{account.name}</strong>
              <p>{account.email}</p>
              <small>데모용 로컬 로그인 상태입니다. 이후 실제 인증 연동 시 세션 또는 토큰 상태로 교체됩니다.</small>
              <button className="dashboard-btn dashboard-btn-primary" onClick={() => setAccount(null)} type="button">
                로그아웃
              </button>
            </div>
          </div>
        </article>

        <article className="dashboard-card dashboard-col-6">
          <header className="dashboard-card-header">
            <div>
              <h3>Preferences</h3>
              <p>기본 보호 설정</p>
            </div>
            <span className="dashboard-pill is-warning">{profileMode}</span>
          </header>
          <div className="dashboard-card-body">
            <div className="dashboard-preference-list">
              <button className="dashboard-preference-row" onClick={() => togglePreference("emailAlerts")} type="button">
                <div>
                  <strong>이메일 알림</strong>
                  <p>고위험 게시글 분석 결과를 메일로 받습니다.</p>
                </div>
                <span className={`dashboard-toggle ${preferences.emailAlerts ? "is-enabled" : ""}`} />
              </button>
              <button className="dashboard-preference-row" onClick={() => togglePreference("autoOpenReport")} type="button">
                <div>
                  <strong>상세 분석 자동 열기</strong>
                  <p>스캔 완료 후 report page를 바로 여는 기본 동작입니다.</p>
                </div>
                <span className={`dashboard-toggle ${preferences.autoOpenReport ? "is-enabled" : ""}`} />
              </button>
              <button className="dashboard-preference-row" onClick={() => togglePreference("loginRequired")} type="button">
                <div>
                  <strong>로그인 필요 모드</strong>
                  <p>조회와 신고 연계를 위해 계정 로그인을 우선 요구합니다.</p>
                </div>
                <span className={`dashboard-toggle ${preferences.loginRequired ? "is-enabled" : ""}`} />
              </button>
            </div>
          </div>
        </article>

        <article className="dashboard-card dashboard-col-12">
          <header className="dashboard-card-header">
            <div>
              <h3>Protection profiles</h3>
              <p>사용자 유형별 기본 해석 강도</p>
            </div>
          </header>
          <div className="dashboard-card-body">
            <div className="dashboard-profile-grid">
              <div className="dashboard-profile-card">
                <strong>Current profile</strong>
                <p>{profileSummary}</p>
              </div>
              <div className="dashboard-profile-card">
                <strong>세션 상태</strong>
                <p>{account ? "활성 세션 1개 / 데모 계정 로그인 완료" : "비로그인 상태 / 확장 로컬 세션만 사용 중"}</p>
              </div>
              <div className="dashboard-profile-card">
                <strong>외부 연계 준비</strong>
                <p>더치트 / 경찰청 연계를 위해 향후 본인 동의와 신고 이력 동기화 슬롯을 이 영역에 추가합니다.</p>
              </div>
            </div>
          </div>
        </article>
        </section>
      )}
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
              <strong>Demo page</strong>
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
              <div className="dashboard-avatar">{account ? account.name.charAt(0).toUpperCase() : "S"}</div>
              <div>
                <strong>{account ? account.name : "safe-ticket"}</strong>
                <span>{account ? account.email : "Scan workspace"}</span>
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
              <strong>{account ? account.name : "safe-ticket"}</strong>
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
