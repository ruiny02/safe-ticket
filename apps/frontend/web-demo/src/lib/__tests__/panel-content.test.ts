import { describe, expect, it } from "vitest";

import type { ScanCreateRequest, ScanResultResponse } from "../../../../shared/types";
import { buildPanelContent } from "../panel-content";

const payload: ScanCreateRequest = {
  platform: "joonggonara",
  page_url: "http://localhost:3000/product/227242032.html",
  page_title: "tuki. Asia tour concert ticket",
  price: 163000,
  seller: {
    seller_id: "4099087",
    nickname: "sellerSJ",
  },
  content_blocks: [],
  marketplace_signals: [],
};

describe("buildPanelContent", () => {
  it("builds a response-driven danger summary for completed scans", () => {
    const scanResult: ScanResultResponse = {
      scan_id: "scan_123",
      status: "completed",
      risk_level: "high",
      risk_score: 0.87,
      summary: "Multiple payment-inducing phrases were detected.",
      risk_tags: ["bank_account_pattern"],
      evidence_items: [],
      highlight_targets: [
        {
          block_id: "body-1",
          start: 10,
          end: 15,
          matched_text: "KakaoBank",
          reason_code: "bank_name_detected",
          reason: "This matches a bank account transfer phrase.",
          css_class: "safe-ticket-highlight-danger",
        },
      ],
      similar_cases: [],
      recommended_actions: [
        {
          action: "verify_identity",
          description: "Cross-check the seller name and deposit account holder.",
        },
      ],
      external_lookup_results: [
        {
          provider: "police",
          kind: "account",
          keyword: "3355288620726",
          status: "completed",
          message: "No recent report history was found.",
          source_url: "https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
          report_count: 0,
          risk_found: false,
          result_text: null,
        },
      ],
      degraded: false,
      report_url: "/report/scan_123",
    };

    const content = buildPanelContent({
      pageUrl: payload.page_url,
      payload,
      scanResult,
      appliedHighlights: scanResult.highlight_targets,
    });

    expect(content.tone).toBe("danger");
    expect(content.headline).toContain("Immediate review");
    expect(content.reasons).toEqual([
      {
        title: "KakaoBank",
        body: "This matches a bank account transfer phrase.",
      },
    ]);
    expect(content.actions[0]).toEqual({
      title: "verify_identity",
      body: "Cross-check the seller name and deposit account holder.",
    });
    expect(content.externalLookups[0]).toEqual({
      title: "Police lookup - account",
      body: "No recent report history was found.",
      statusLabel: "no reports",
      tone: "ok",
      keyword: "3355-28-8620726",
    });
  });

  it("builds a ready-state summary before the scan is sent", () => {
    const content = buildPanelContent({
      pageUrl: payload.page_url,
      payload,
      scanResult: null,
    });

    expect(content.tone).toBe("ok");
    expect(content.statusLabel).toBe("ready");
    expect(content.headline).toBe("Scan ready");
    expect(content.summary).toContain("Scan");
    expect(content.actions[0]).toEqual({
      title: "Run scan",
      body: "백엔드로 분석 요청을 보내고 위험 점수, 하이라이트, 권장 행동을 받아옵니다.",
    });
  });
});
