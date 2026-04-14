import { describe, expect, it } from "vitest";

import { buildPanelContent } from "../panel-content";
import type { ScanCreateRequest, ScanResultResponse } from "../../../../shared/types";

const payload: ScanCreateRequest = {
  platform: "joonggonara",
  page_url: "http://localhost:3000/product/227242032.html",
  page_title: "tuki. 츠키 아시아투어콘서트 정가*~-",
  price: 163000,
  seller: {
    seller_id: "4099087",
    nickname: "낭닥SJ",
  },
  content_blocks: [],
};

describe("buildPanelContent", () => {
  it("builds a response-driven danger summary for completed scans", () => {
    const scanResult: ScanResultResponse = {
      scan_id: "scan_123",
      status: "completed",
      risk_level: "high",
      risk_score: 0.87,
      summary: "은행명과 계좌번호 패턴이 함께 잡혔습니다.",
      risk_tags: ["bank_account_pattern"],
      evidence_items: [],
      highlight_targets: [
        {
          block_id: "body-1",
          start: 10,
          end: 15,
          matched_text: "카카오뱅크",
          reason_code: "bank_name_detected",
          reason: "모니터링 대상 은행명입니다.",
          css_class: "safe-ticket-highlight-danger",
        },
      ],
      similar_cases: [],
      recommended_actions: [
        {
          action: "verify_identity",
          description: "판매자 실명과 계좌 예금주를 교차 확인하세요.",
        },
      ],
      degraded: false,
      report_url: "/report/scan_123",
    };

    const content = buildPanelContent({
      pageUrl: payload.page_url,
      payload,
      scanResult,
    });

    expect(content.tone).toBe("danger");
    expect(content.headline).toContain("즉시 확인");
    expect(content.reasons).toEqual([
      {
        title: "카카오뱅크",
        body: "모니터링 대상 은행명입니다.",
      },
    ]);
    expect(content.actions[0]).toEqual({
      title: "verify_identity",
      body: "판매자 실명과 계좌 예금주를 교차 확인하세요.",
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
    expect(content.headline).toBe("스캔 준비");
    expect(content.summary).toContain("페이지를 읽었습니다");
    expect(content.actions[0]).toEqual({
      title: "바로 실행",
      body: "스캔을 보내면 위험 신호와 다음 행동을 짧게 정리해 보여줍니다.",
    });
  });
});
