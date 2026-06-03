import { describe, expect, it } from "vitest";

import type { ScanCreateRequest, ScanResultResponse } from "../../../../shared/types";
import { buildAssistantReply, buildChatWelcomeMessage, buildSuggestedPrompts } from "../chatbot";

const payload: ScanCreateRequest = {
  platform: "joonggonara",
  page_url: "https://web.joongna.com/product/227242032",
  page_title: "아이오아이 콘서트 티켓 양도",
  price: 163000,
  seller: {
    seller_id: "4099087",
    nickname: "sellerSJ",
  },
  content_blocks: [],
  marketplace_signals: [
    {
      key: "trust_score",
      label: "신뢰지수",
      value: "91",
    },
    {
      key: "safe_payment",
      label: "안심결제",
      value: "가능",
    },
  ],
};

const scanResult: ScanResultResponse = {
  scan_id: "scan_123",
  status: "completed",
  risk_level: "high",
  risk_score: 0.87,
  summary: "입금 유도 표현과 외부 메신저 이동 표현이 감지되었습니다.",
  risk_tags: ["avoid_safe_payment", "off_platform_contact"],
  evidence_items: [],
  highlight_targets: [
    {
      block_id: "body-1",
      start: 10,
      end: 15,
      matched_text: "카카오뱅크",
      reason_code: "bank_name_detected",
      reason: "계좌이체를 유도하는 표현으로 해석될 수 있습니다.",
      css_class: "safe-ticket-highlight-danger",
    },
  ],
  similar_cases: [
    {
      case_id: "case_1",
      score: 0.72,
      summary: "비슷한 송금 유도 문구가 포함된 티켓 양도 사례입니다.",
    },
  ],
  recommended_actions: [
    {
      action: "verify_identity",
      description: "판매자 이름과 입금 계좌 예금주를 교차 확인하세요.",
    },
  ],
  external_lookup_results: [
    {
      provider: "police",
      kind: "account",
      keyword: "3355288620726",
      status: "completed",
      message: "최근 3개월 내 신고 이력은 확인되지 않았습니다.",
      source_url: "https://www.police.go.kr",
      report_count: 0,
      risk_found: false,
      result_text: null,
    },
  ],
  degraded: false,
  report_url: "/report/scan_123",
};

describe("chatbot helpers", () => {
  it("builds a welcome message from the current scan state", () => {
    expect(buildChatWelcomeMessage(payload, scanResult)).toContain("현재 위험도는 높음");
  });

  it("returns contextual suggested prompts", () => {
    expect(buildSuggestedPrompts(payload, scanResult)).toContain("왜 위험한가요?");
  });

  it("answers a risk question from scan results", () => {
    expect(
      buildAssistantReply({
        payload,
        scanResult,
        prompt: "왜 위험한가요?",
      }),
    ).toContain("카카오뱅크");
  });

  it("answers a trust-signal question from parsed signals", () => {
    expect(
      buildAssistantReply({
        payload,
        scanResult,
        prompt: "신뢰지표를 요약해줘",
      }),
    ).toContain("신뢰지수");
  });

  it("answers an external lookup question", () => {
    expect(
      buildAssistantReply({
        payload,
        scanResult,
        prompt: "외부조회 결과를 알려줘",
      }),
    ).toContain("경찰청");
  });
});
