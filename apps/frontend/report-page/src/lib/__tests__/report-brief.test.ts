import { describe, expect, it } from "vitest";

import type { PipelineExchangeResponse, ScanResultResponse } from "../../../../shared/types";
import { buildDashboardModel } from "../dashboard-model";
import { buildReportBrief } from "../report-brief";

const scanResult: ScanResultResponse = {
  scan_id: "scan_1234abcd",
  status: "completed",
  risk_level: "high",
  risk_score: 0.91,
  summary: "계좌 패턴과 선입금 유도 표현이 함께 감지되었습니다.",
  risk_tags: ["bank_account_pattern", "avoid_safe_payment"],
  evidence_items: [],
  highlight_targets: [
    {
      block_id: "body-1",
      start: 8,
      end: 13,
      matched_text: "카카오뱅크",
      reason_code: "bank_name_detected",
      reason: "모니터링 대상 은행명입니다.",
      css_class: "safe-ticket-highlight-danger",
    },
    {
      block_id: "body-1",
      start: 22,
      end: 37,
      matched_text: "3355-28-8620726",
      reason_code: "bank_account_pattern",
      reason: "적금통장 패턴과 유사합니다.",
      css_class: "safe-ticket-highlight-danger",
    },
  ],
  similar_cases: [
    {
      case_id: "case_11",
      score: 0.88,
      summary: "외부 메신저로 이동 후 선입금을 요구한 사례",
    },
  ],
  recommended_actions: [
    {
      action: "계좌 재확인",
      description: "예금주, 은행명, 계좌번호를 다시 확인하세요.",
    },
    {
      action: "추가 입금 중단",
      description: "추가 송금 요청이 오면 바로 거래를 중단하세요.",
    },
  ],
  degraded: false,
  report_url: "/report/scan_1234abcd",
};

const pipelineDebug: PipelineExchangeResponse = {
  scan_id: "scan_1234abcd",
  outbound_payload: {
    scan_id: "scan_1234abcd",
    platform: "joonggonara",
    page_url: "http://localhost:3000/product/227242032.html",
    page_title: "tuki. 츠키 아시아투어콘서트 정가*~-",
    price: 163000,
    seller: {
      seller_id: "4099087",
      nickname: "낭닥SJ",
    },
    content_blocks: [
      {
        block_id: "body-1",
        text: "입금 은행 : 카카오뱅크\n계좌 번호 : 3355-28-8620726",
      },
    ],
    marketplace_signals: [],
  },
  inbound_payload: {
    risk_level: "high",
    risk_score: 0.91,
    summary: "계좌 패턴과 선입금 유도 표현이 함께 감지되었습니다.",
    risk_tags: ["bank_account_pattern", "avoid_safe_payment"],
    evidence_items: [],
    highlight_targets: [],
    similar_cases: [],
    recommended_actions: [],
    degraded: false,
  },
};

describe("buildReportBrief", () => {
  it("builds concise narrative sections from the active scan context", () => {
    const dashboard = buildDashboardModel({ scanResult, pipelineDebug });
    const brief = buildReportBrief({ scanResult, dashboard, pipelineDebug });

    expect(brief.sections.map((section) => section.title)).toEqual([
      "판단 요약",
      "문제 핵심",
      "판매자 관찰",
      "권장 대응",
      "원문 근거",
    ]);
    expect(brief.sections[1]?.sentences.join(" ")).toContain("카카오뱅크");
    expect(brief.sections[2]?.sentences.join(" ")).toContain("낭닥SJ");
    expect(brief.sections[3]?.sentences).toContain("예금주, 은행명, 계좌번호를 다시 확인하세요.");
  });
});
