import type { PipelineExchangeResponse, ScanResultResponse } from "../../../shared/types";
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
    pipeline: "Raw embedding -> PCA(50) -> UMAP(2)";
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
    sellerName: string;
    primaryAlias: string;
    accountNumber: string;
    recentFraudCases: number;
    observedAliases: string[];
  };
  sellerSignals: DashboardSignal[];
  reasons: DashboardSignal[];
  actions: DashboardSignal[];
  lookupLinks: DashboardLookupLink[];
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}점`;
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

export function buildDashboardModel({
  scanResult,
  pipelineDebug,
}: {
  scanResult: ScanResultResponse;
  pipelineDebug: PipelineExchangeResponse | null;
}): DashboardModel {
  const headline = riskHeadline(scanResult.risk_level);
  const seller = pipelineDebug?.outbound_payload.seller;
  const highlightCount = scanResult.highlight_targets.length;
  const similarCaseCount = scanResult.similar_cases.length;
  const riskPercentile = Math.min(99, Math.max(3, Math.round((scanResult.risk_score ?? 0.5) * 100)));
  const embedding = buildDemoEmbeddingResult({
    scanId: scanResult.scan_id,
    riskLevel: scanResult.risk_level,
    highlightCount,
  });
  const accountNumber = extractAccountNumber(pipelineDebug?.outbound_payload.content_blocks ?? []);

  return {
    hero: {
      eyebrow: `scan ${scanResult.scan_id}`,
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
      title: "임베딩 공간 시각화",
      description:
        "데모 임베딩 DB를 만들고, 원본 임베딩에서 PCA(50)를 거쳐 UMAP(2)로 축소한 좌표를 사용해 사기 / 정상 / 경계 군집과 현재 게시글의 거리를 보여줍니다.",
      pipeline: embedding.pipeline,
      points: embedding.points,
      summary: embedding.summary,
    },
    sellerObservation: {
      sellerName: seller?.nickname ?? "미확인",
      primaryAlias: seller?.nickname ?? "미확인",
      accountNumber,
      recentFraudCases: similarCaseCount + 1,
      observedAliases: [seller?.nickname ?? "미확인", "급처티켓", "openchat123"],
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
