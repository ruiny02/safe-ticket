import type {
  CaseUmapResponse,
  CaseUmapVariant,
  ExternalLookupResult,
  MarketplaceSignal,
  PipelineExchangeResponse,
  RiskMapResponse,
  ScanResultResponse,
} from "../../../shared/types";
import {
  externalLookupStatusLabel,
  externalLookupTitle,
  formatExternalLookupKeyword,
} from "../../../shared/external-lookup-display";
import { buildDemoEmbeddingResult, type DemoEmbeddingPoint } from "./demo-embedding";

type Tone = "danger" | "warning" | "ok";

export interface DashboardOverviewItem {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface DashboardSignal {
  label: string;
  value: string;
  tone: "default" | "warning" | "danger";
}

export interface DashboardLookupLink {
  label: string;
  href: string;
  description: string;
}

export interface DashboardExternalLookup {
  title: string;
  keyword: string;
  statusLabel: string;
  message: string;
  tone: Tone;
  sourceUrl: string;
}

export interface DashboardModel {
  hero: {
    eyebrow: string;
    title: string;
    summary: string;
    tone: Tone;
  };
  overview: {
    label: string;
    items: DashboardOverviewItem[];
  };
  embedding: {
    title: string;
    description: string;
    pipeline: string;
    points: DemoEmbeddingPoint[];
    summary: {
      nearestCluster: "fraud" | "safe" | "borderline";
      clusterCounts: {
        fraud: number;
        safe: number;
        borderline: number;
      };
      distances: {
        fraud: number;
        safe: number;
        borderline: number;
      };
    };
  };
  sellerObservation: {
    listingTitle: string;
    sellerName: string;
    primaryAlias: string;
    priceText: string;
    trustSignals: MarketplaceSignal[];
    accountNumber: string;
    recentFraudCases: number;
    observedAliases: string[];
  };
  sellerSignals: DashboardSignal[];
  reasons: DashboardSignal[];
  actions: DashboardSignal[];
  externalLookups: DashboardExternalLookup[];
  lookupLinks: DashboardLookupLink[];
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}점`;
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "미확인";
  }

  return `${value.toLocaleString("ko-KR")}원`;
}

function riskHeadline(riskLevel: ScanResultResponse["risk_level"]): { title: string; tone: Tone } {
  if (riskLevel === "high") {
    return {
      title: "즉시 거래를 멈추고 재확인하세요",
      tone: "danger",
    };
  }

  if (riskLevel === "medium") {
    return {
      title: "추가 확인이 필요한 거래입니다",
      tone: "warning",
    };
  }

  return {
    title: "현재 규칙 기준에서는 낮은 위험입니다",
    tone: "ok",
  };
}

function extractAccountNumber(contentBlocks: { text: string }[]): string {
  const joined = contentBlocks.map((block) => block.text).join("\n");
  const match = joined.match(/\b\d{3,4}-\d{2}-\d{6,7}\b/);

  return match?.[0] ?? "미확인";
}

function uniqueVisibleValues(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value) && value !== "미확인"),
    ),
  );
}

function lookupTone(result: ExternalLookupResult): Tone {
  if (result.status === "failed" || result.risk_found === true) {
    return "danger";
  }

  if (result.status === "login_required") {
    return "warning";
  }

  return "ok";
}

function buildExternalLookups(results: ExternalLookupResult[] = []): DashboardExternalLookup[] {
  return results.map((result) => ({
    title: externalLookupTitle(result),
    keyword: formatExternalLookupKeyword(result),
    statusLabel: externalLookupStatusLabel(result),
    message: result.message,
    tone: lookupTone(result),
    sourceUrl: result.source_url,
  }));
}

function isClusterVariant(value: CaseUmapVariant): value is "fraud" | "safe" | "borderline" {
  return value === "fraud" || value === "safe" || value === "borderline";
}

function buildEmbeddingModel({
  caseUmap,
  caseRiskMap,
  scanResult,
  highlightCount,
}: {
  caseUmap: CaseUmapResponse | null;
  caseRiskMap?: RiskMapResponse | null;
  scanResult: ScanResultResponse;
  highlightCount: number;
}): DashboardModel["embedding"] {
  if (caseRiskMap?.points.length) {
    return buildRiskMapEmbeddingModel(caseRiskMap, scanResult);
  }

  if (!caseUmap?.points.length) {
    const demoEmbedding = buildDemoEmbeddingResult({
      scanId: scanResult.scan_id,
      riskLevel: scanResult.risk_level,
      highlightCount,
    });
    return {
      title: "임베딩 공간 시각화",
      description:
        "데모 임베딩 DB를 만들고, 원본 임베딩에서 PCA(50)를 거쳐 UMAP(3)로 축소한 좌표를 2D와 3D로 함께 보여줍니다.",
      pipeline: demoEmbedding.pipeline,
      points: demoEmbedding.points,
      summary: demoEmbedding.summary,
    };
  }

  const points = caseUmap.points.map((point) => ({
    id: point.case_id,
    label: point.label,
    x: point.x,
    y: point.y,
    z: point.z,
    x3d: point.x_3d ?? point.x,
    y3d: point.y_3d ?? point.y,
    z3d: point.z_3d ?? point.z,
    variant: point.variant,
  }));
  const fallbackNearest =
    scanResult.risk_level === "low" ? "safe" : scanResult.risk_level === "medium" ? "borderline" : "fraud";
  const nearestCluster = caseUmap.current_scan?.nearest_cluster ?? fallbackNearest;

  return {
    title: "임베딩 공간 시각화",
    description:
      "backend에 저장된 case chunk 임베딩을 case 단위로 평균낸 뒤 PCA와 supervised UMAP으로 축소해 라벨 기반 위험군 구조와 현재 게시글의 위치를 보여줍니다.",
    pipeline: caseUmap.projection.pipeline,
    points,
    summary: {
      nearestCluster: isClusterVariant(nearestCluster) ? nearestCluster : fallbackNearest,
      clusterCounts: {
        fraud: caseUmap.risk_counts.fraud ?? 0,
        safe: caseUmap.risk_counts.safe ?? 0,
        borderline: caseUmap.risk_counts.borderline ?? 0,
      },
      distances: {
        fraud: caseUmap.current_scan?.distances.fraud ?? 0,
        safe: caseUmap.current_scan?.distances.safe ?? 0,
        borderline: caseUmap.current_scan?.distances.borderline ?? 0,
      },
    },
  };
}

function buildRiskMapEmbeddingModel(
  caseRiskMap: RiskMapResponse,
  scanResult: ScanResultResponse,
): DashboardModel["embedding"] {
  const points = caseRiskMap.points.map((point) => ({
    id: point.case_id,
    label: point.title ?? point.case_id,
    x: point.x,
    y: point.y,
    z: point.z ?? 50,
    x3d: point.x,
    y3d: point.y,
    z3d: point.z ?? 50,
    variant: point.label,
    riskScore: point.score,
  }));
  const clusterCounts = points.reduce(
    (acc, point) => {
      if (isClusterVariant(point.variant)) {
        acc[point.variant] += 1;
      }
      return acc;
    },
    { fraud: 0, safe: 0, borderline: 0 },
  );
  const fallbackNearest =
    scanResult.risk_level === "low" ? "safe" : scanResult.risk_level === "medium" ? "borderline" : "fraud";
  const title =
    caseRiskMap.projection_type === "pls1_semantic_residual_umap_v1"
      ? "Risk-axis semantic map"
      : caseRiskMap.projection_type === "pls7_umap_risk_aware_v1"
        ? "PLS7 risk-aware map"
      : "Risk-map 시각화";
  const description =
    caseRiskMap.projection_type === "pls1_semantic_residual_umap_v1"
      ? "x축은 calibrated PLS1 위험도 축으로 정렬하고, y/z축은 위험도 1차 방향을 제거한 semantic residual을 UMAP으로 축소해 의미적 이웃 구조를 보여줍니다."
      : caseRiskMap.projection_type === "pls7_umap_risk_aware_v1"
        ? "raw embedding을 PLS(7) risk-aware latent space로 변환한 뒤 unsupervised UMAP으로 축소해 유사 위험 패턴의 군집을 보여줍니다."
      : "PLS risk-axis 점수를 x축에 두고, 점수로 설명되지 않는 residual 구조를 UMAP으로 축소해 2D와 3D에서 보여줍니다.";
  const pipeline =
    caseRiskMap.projection_type === "pls1_semantic_residual_umap_v1"
      ? "raw embedding -> PLS1 risk axis + semantic residual UMAP(2/3)"
      : caseRiskMap.projection_type === "pls7_umap_risk_aware_v1"
        ? "raw embedding -> PLS(7) -> weighted UMAP(3)"
      : `score-aligned PLS risk-map -> residual ${caseRiskMap.reducer.toUpperCase()}(3)`;

  return {
    title,
    description,
    pipeline,
    points,
    summary: {
      nearestCluster: fallbackNearest,
      clusterCounts,
      distances: {
        fraud: riskMapCenterDistance(caseRiskMap, "fraud"),
        safe: riskMapCenterDistance(caseRiskMap, "safe"),
        borderline: riskMapCenterDistance(caseRiskMap, "borderline"),
      },
    },
  };
}

function riskMapCenterDistance(
  caseRiskMap: RiskMapResponse,
  label: "fraud" | "safe" | "borderline",
): number {
  const points = caseRiskMap.points.filter((point) => point.label === label);
  const currentPoint = caseRiskMap.points.find((point) => point.label === "current");
  if (!points.length) {
    return 0;
  }
  if (!currentPoint) {
    const center = points.reduce((sum, point) => sum + point.score, 0) / points.length;
    return Math.abs(center - 0.5) * 100;
  }
  const center = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x / points.length,
      y: acc.y + point.y / points.length,
      z: acc.z + (point.z ?? 50) / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return Math.hypot(currentPoint.x - center.x, currentPoint.y - center.y, (currentPoint.z ?? 50) - center.z);
}

export function buildDashboardModel({
  scanResult,
  pipelineDebug,
  caseUmap,
  caseRiskMap = null,
}: {
  scanResult: ScanResultResponse;
  pipelineDebug: PipelineExchangeResponse | null;
  caseUmap: CaseUmapResponse | null;
  caseRiskMap?: RiskMapResponse | null;
}): DashboardModel {
  const headline = riskHeadline(scanResult.risk_level);
  const seller = pipelineDebug?.outbound_payload.seller;
  const highlightCount = scanResult.highlight_targets.length;
  const similarCaseCount = scanResult.similar_cases.length;
  const riskPercentile = Math.min(99, Math.max(3, Math.round((scanResult.risk_score ?? 0.5) * 100)));
  const embedding = buildEmbeddingModel({ caseUmap, caseRiskMap, scanResult, highlightCount });
  const accountNumber = extractAccountNumber(pipelineDebug?.outbound_payload.content_blocks ?? []);

  return {
    hero: {
      eyebrow: "SCAN RESULT",
      title: headline.title,
      summary:
        scanResult.summary ??
        "현재 스캔 결과를 바탕으로 위험 신호와 유사 사례를 요약해 보여줍니다.",
      tone: headline.tone,
    },
    overview: {
      label: "Risk overview",
      items: [
        {
          label: "Scan quality",
          value: toPercent(scanResult.risk_score ?? 0),
          detail: `${scanResult.risk_level ?? "unknown"} risk`,
          tone: headline.tone,
        },
        {
          label: "Protected buyers",
          value: `${Math.max(200, 240 + highlightCount * 18)}`,
          detail: "계정 보호 기준으로 재가공된 사용자 수",
          tone: "ok",
        },
        {
          label: "Manual review",
          value: `${Math.max(9, similarCaseCount + highlightCount)}`,
          detail: `상위 ${riskPercentile}% 위험 구간`,
          tone: "warning",
        },
      ],
    },
    embedding: {
      title: embedding.title,
      description: embedding.description,
      pipeline: embedding.pipeline,
      points: embedding.points,
      summary: embedding.summary,
    },
    sellerObservation: {
      listingTitle: pipelineDebug?.outbound_payload.page_title ?? "미확인",
      sellerName: seller?.nickname ?? "미확인",
      primaryAlias: seller?.nickname ?? "미확인",
      priceText: formatPrice(pipelineDebug?.outbound_payload.price),
      trustSignals: pipelineDebug?.outbound_payload.marketplace_signals ?? [],
      accountNumber,
      recentFraudCases: similarCaseCount,
      observedAliases: uniqueVisibleValues([seller?.nickname]),
    },
    sellerSignals: [
      {
        label: "판매자 닉네임",
        value: seller?.nickname ?? "미확인",
        tone: "default",
      },
      {
        label: "주요 계좌번호",
        value: accountNumber,
        tone: "default",
      },
      {
        label: "최근 관찰",
        value: `${similarCaseCount + 1}회`,
        tone: scanResult.risk_level === "high" ? "warning" : "default",
      },
    ],
    reasons: scanResult.highlight_targets.map((target) => ({
      label: target.matched_text,
      value: target.reason,
      tone: "danger",
    })),
    actions: scanResult.recommended_actions.map((action) => ({
      label: action.action,
      value: action.description,
      tone: "default",
    })),
    externalLookups: buildExternalLookups(scanResult.external_lookup_results),
    lookupLinks: [
      {
        label: "경찰청 조회 안내",
        href: "https://ecrm.police.go.kr/",
        description: "공식 신고 절차와 필요한 입력값을 다시 확인합니다.",
      },
      {
        label: "더치트 조회",
        href: "https://thecheat.co.kr/",
        description: "계좌번호, 연락처, 판매자 단서가 이미 신고되었는지 확인합니다.",
      },
    ],
  };
}
