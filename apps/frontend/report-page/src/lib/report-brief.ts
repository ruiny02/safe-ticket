import type { PipelineExchangeResponse, ScanResultResponse } from "../../../shared/types";
import type { DashboardModel } from "./dashboard-model";

export interface ReportBriefSection {
  title: string;
  sentences: string[];
}

export interface ReportBrief {
  sections: ReportBriefSection[];
}

function joinHighlights(scanResult: ScanResultResponse): string {
  const highlights = scanResult.highlight_targets.slice(0, 3).map((target) => target.matched_text);

  if (highlights.length === 0) {
    return "명시적 하이라이트는 아직 없습니다";
  }

  return highlights.join(", ");
}

export function buildReportBrief({
  scanResult,
  dashboard,
  pipelineDebug,
}: {
  scanResult: ScanResultResponse;
  dashboard: DashboardModel;
  pipelineDebug: PipelineExchangeResponse | null;
}): ReportBrief {
  const outboundPayload = pipelineDebug?.outbound_payload;
  const sellerName = dashboard.sellerObservation.sellerName;
  const aliases = dashboard.sellerObservation.observedAliases;
  const keyActions = dashboard.actions.slice(0, 2).map((action) => action.value);
  const accountNumber = dashboard.sellerObservation.accountNumber;
  const similarCaseCount = dashboard.sellerObservation.recentFraudCases;
  const accountSentence =
    accountNumber === "미확인"
      ? `${sellerName} 판매글에서 자동 추출된 계좌번호는 아직 확인되지 않았습니다.`
      : `${sellerName} 판매글에서 ${accountNumber} 계좌가 관찰됐습니다.`;
  const similarCaseSentence =
    similarCaseCount > 0
      ? `현재 게시글은 유사 사례 ${similarCaseCount}건과 함께 비교됐습니다.`
      : "현재 게시글과 직접 연결된 유사 사례는 아직 충분하지 않습니다.";
  const aliasSentence =
    aliases.length > 0
      ? `확인된 판매자 닉네임은 ${aliases.join(", ")} 입니다.`
      : "추가로 확인된 판매자 별칭은 없습니다.";

  return {
    sections: [
      {
        title: "판단 요약",
        sentences: [
          `현재 게시글은 ${scanResult.risk_level ?? "unknown"} 위험으로 분류됐고, 요약 점수는 ${Math.round((scanResult.risk_score ?? 0) * 100)}점입니다.`,
          scanResult.summary ?? "스캔 요약이 아직 비어 있습니다.",
          `임베딩 공간에서는 ${dashboard.embedding.summary.nearestCluster} cluster에 가장 가까운 패턴으로 표시됩니다.`,
        ],
      },
      {
        title: "문제 핵심",
        sentences: [
          `이번 게시글에서 직접 표시된 핵심 문구는 ${joinHighlights(scanResult)} 입니다.`,
          `특히 ${dashboard.reasons.slice(0, 2).map((reason) => `${reason.label}(${reason.value})`).join(", ")} 신호가 현재 판단을 끌어올렸습니다.`,
        ],
      },
      {
        title: "판매자 관찰",
        sentences: [
          accountSentence,
          similarCaseSentence,
          aliasSentence,
        ],
      },
      {
        title: "권장 대응",
        sentences: keyActions.length > 0
          ? keyActions
          : ["현재 게시글은 추가 확인이 필요합니다. 거래 전 신원과 계좌를 재확인하세요."],
      },
      {
        title: "원문 근거",
        sentences: [
          `분석에 사용한 게시글 제목은 "${outboundPayload?.page_title ?? "미확인"}" 입니다.`,
          `원문 주소는 ${outboundPayload?.page_url ?? "미확인"} 이고, 수집 본문에서 계좌 및 위험 문구가 직접 확인됐습니다.`,
        ],
      },
    ],
  };
}
