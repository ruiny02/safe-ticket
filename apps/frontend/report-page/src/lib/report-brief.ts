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

function joinReasonSignals(dashboard: DashboardModel): string {
  const reasons = dashboard.reasons.slice(0, 3).map((reason) => `${reason.label}(${reason.value})`);

  return reasons.length ? reasons.join(", ") : "별도 신호 없음";
}

function buildActionSentences(actions: string[], riskLevel: ScanResultResponse["risk_level"]): string[] {
  const fallbackActions = [
    "거래 전 판매자 신원, 예매 내역, 계좌 명의가 서로 일치하는지 먼저 확인하세요.",
    "플랫폼 안전결제나 공식 거래 보호 절차를 사용할 수 없다면 송금을 보류하세요.",
    "외부 메신저 이동, 추가 입금, 급한 결제 압박이 나오면 거래를 중단하세요.",
    "증빙 화면과 대화 내용을 남긴 뒤 필요한 경우 신고 채널에서 다시 조회하세요.",
  ];
  const riskAwareAction =
    riskLevel === "high"
      ? "높은 위험으로 분류된 거래이므로 상대방이 재촉하더라도 즉시 송금하지 말고 검증을 먼저 끝내세요."
      : "낮거나 중간 위험으로 보이더라도 티켓 거래는 취소·양도 조건을 확인한 뒤 진행하세요.";
  const nextActions = actions.length ? actions : fallbackActions.slice(0, 2);

  return [...nextActions, riskAwareAction, fallbackActions.at(-1) ?? ""].filter(Boolean).slice(0, 4);
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
  const keyActions = dashboard.actions.slice(0, 2).map((action) => action.value);
  const accountNumber = dashboard.sellerObservation.accountNumber;
  const similarCaseCount = dashboard.sellerObservation.recentFraudCases;
  const accountEvidenceSentence =
    accountNumber === "미확인"
      ? "자동 추출된 계좌번호가 없더라도 거래 방식, 연락처, 외부 이동 요구를 함께 확인해야 합니다."
      : `원문에서 ${accountNumber} 계좌 단서가 확인되어 계좌 명의와 거래 방식의 일치 여부를 검증해야 합니다.`;
  const similarCaseSentence =
    similarCaseCount > 0
      ? `현재 게시글은 유사 사례 ${similarCaseCount}건과 함께 비교됐습니다.`
      : "현재 게시글과 직접 연결된 유사 사례는 아직 충분하지 않습니다.";
  const highlightCount = scanResult.highlight_targets.length;
  const evidenceCount = scanResult.evidence_items.length;
  const contentBlockCount = outboundPayload?.content_blocks.length ?? 0;
  const marketplaceSignalCount = outboundPayload?.marketplace_signals.length ?? 0;

  return {
    sections: [
      {
        title: "판단 요약",
        sentences: [
          `현재 게시글은 ${scanResult.risk_level ?? "unknown"} 위험으로 분류됐고, 요약 점수는 ${Math.round((scanResult.risk_score ?? 0) * 100)}점입니다.`,
          scanResult.summary ?? "스캔 요약이 아직 비어 있습니다.",
          `임베딩 공간에서는 ${dashboard.embedding.summary.nearestCluster} cluster에 가장 가까운 패턴으로 표시됩니다.`,
          `${similarCaseSentence} 이 비교 결과는 현재 글이 기존 사기/정상 사례 중 어느 쪽 패턴에 더 가까운지 판단하는 보조 근거로 사용됩니다.`,
        ],
      },
      {
        title: "문제 핵심",
        sentences: [
          `이번 게시글에서 직접 표시된 핵심 문구는 ${joinHighlights(scanResult)} 입니다.`,
          `특히 ${joinReasonSignals(dashboard)} 신호가 현재 판단을 끌어올렸습니다.`,
          accountEvidenceSentence,
          "단일 문구 하나만으로 단정하지 않고, 계좌·외부조회·유사사례·하이라이트 근거를 함께 묶어 위험도를 계산했습니다.",
        ],
      },
      {
        title: "권장 대응",
        sentences: buildActionSentences(keyActions, scanResult.risk_level),
      },
      {
        title: "원문 근거",
        sentences: [
          `분석에 사용한 게시글 제목은 "${outboundPayload?.page_title ?? "미확인"}" 입니다.`,
          `원문 주소는 ${outboundPayload?.page_url ?? "미확인"} 이며, scan 생성 시점의 수집 payload를 기준으로 판단했습니다.`,
          `backend가 검증한 하이라이트는 ${highlightCount}개, 근거 항목은 ${evidenceCount}개입니다.`,
          `수집 본문 블록 ${contentBlockCount}개와 마켓플레이스 신뢰지표 ${marketplaceSignalCount}개를 함께 사용했습니다.`,
        ],
      },
    ],
  };
}
