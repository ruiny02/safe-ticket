import { describe, expect, it } from "vitest";

import type { PipelineExchangeResponse, ScanResultResponse } from "../../../../shared/types";
import { buildDashboardModel } from "../dashboard-model";

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
    {
      case_id: "case_21",
      score: 0.76,
      summary: "은행 계좌를 두 번 바꿔서 입금을 요구한 사례",
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

describe("buildDashboardModel", () => {
  it("builds a report-page dashboard model with consolidated overview, seller observation, and embedding metadata", () => {
    const model = buildDashboardModel({
      scanResult,
      pipelineDebug,
    });

    expect(model.hero.title).toContain("즉시 거래를 멈추고");
    expect(model.overview.label).toBe("Risk overview");
    expect(model.overview.items.map((item) => item.label)).toEqual([
      "Scan quality",
      "Protected buyers",
      "Manual review",
    ]);
    expect(model.embedding.pipeline).toBe("Raw embedding -> PCA(50) -> UMAP(2)");
    expect(model.embedding.points.length).toBeGreaterThanOrEqual(60);
    expect(model.embedding.points.some((point) => point.variant === "current")).toBe(true);
    expect(model.embedding.points.some((point) => point.variant === "fraud")).toBe(true);
    expect(model.embedding.points.some((point) => point.variant === "safe")).toBe(true);
    expect(model.embedding.points.some((point) => point.variant === "borderline")).toBe(true);
    expect(model.embedding.summary.nearestCluster).toBe("fraud");
    expect(model.embedding.summary.clusterCounts).toEqual({
      fraud: 24,
      safe: 24,
      borderline: 18,
    });
    expect(model.sellerObservation).toEqual({
      sellerName: "낭닥SJ",
      primaryAlias: "낭닥SJ",
      accountNumber: "3355-28-8620726",
      recentFraudCases: 3,
      observedAliases: ["낭닥SJ", "급처티켓", "openchat123"],
    });
    expect(model.lookupLinks.map((link) => link.label)).toEqual(["경찰청 조회 안내", "더치트 조회"]);
  });
});
