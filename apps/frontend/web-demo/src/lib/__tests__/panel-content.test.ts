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
      external_lookup_results: [
        {
          provider: "police",
          kind: "account",
          keyword: "3355288620726",
          status: "completed",
          message: "최근 3개월 내 사기 피해 신고가 3건 이상 접수된 이력은 확인되지 않습니다.",
          source_url: "https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
          report_count: 0,
          risk_found: false,
          result_text: null,
        },
        {
          provider: "thecheat",
          kind: "account",
          keyword: "3355288620726",
          status: "login_required",
          message: "더치트 조회는 로그인 또는 앱 OTP 인증이 필요합니다.",
          source_url: "https://thecheat.co.kr/rb/?mod=ssl_login_otp",
          report_count: null,
          risk_found: null,
          result_text: "로그인이 필요합니다.",
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
    expect(content.externalLookups).toEqual([
      {
        title: "경찰청 · 계좌",
        body: "최근 3개월 내 사기 피해 신고가 3건 이상 접수된 이력은 확인되지 않습니다.",
        statusLabel: "completed",
        tone: "ok",
        keyword: "3355288620726",
      },
      {
        title: "더치트 · 계좌",
        body: "더치트 조회는 로그인 또는 앱 OTP 인증이 필요합니다.",
        statusLabel: "login_required",
        tone: "warning",
        keyword: "3355288620726",
      },
    ]);
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
