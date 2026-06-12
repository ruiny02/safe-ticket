import { describe, expect, it } from "vitest";

import type { ScanCreateRequest, ScanResultResponse } from "../../../../shared/types";
import { buildAssistantReply, buildChatWelcomeMessage, buildSuggestedPrompts } from "../chatbot";

const payload: ScanCreateRequest = {
  platform: "bunjang",
  page_url: "https://m.bunjang.co.kr/products/411763350",
  page_title: "콘서트 티켓 양도",
  price: 163000,
  seller: {
    seller_id: "4099087",
    nickname: "sellerSJ",
  },
  content_blocks: [],
  marketplace_signals: [
    {
      key: "seller_rating",
      label: "별점",
      value: "4.9",
    },
    {
      key: "review_count",
      label: "후기",
      value: "11",
    },
    {
      key: "transaction_count",
      label: "거래내역",
      value: "44",
    },
  ],
};

const scanResult: ScanResultResponse = {
  scan_id: "scan_123",
  status: "completed",
  risk_level: "low",
  risk_score: 0.1,
  summary: "Low risk detected based on these signals: ticket_transfer_risk.",
  risk_tags: ["ticket_transfer_risk"],
  evidence_items: [],
  highlight_targets: [
    {
      block_id: "body-1",
      start: 10,
      end: 13,
      matched_text: "콘서트",
      reason_code: "ticket_transfer_risk",
      reason: "티켓 거래 맥락에서 자주 보이는 표현입니다.",
      css_class: "safe-ticket-highlight-danger",
    },
    {
      block_id: "body-1",
      start: 14,
      end: 16,
      matched_text: "좌석",
      reason_code: "ticket_transfer_risk",
      reason: "티켓 거래 맥락에서 자주 보이는 표현입니다.",
      css_class: "safe-ticket-highlight-danger",
    },
  ],
  similar_cases: [],
  recommended_actions: [
    {
      action: "verify_identity",
      description: "판매자 이름과 입금 계좌 예금주를 교차 확인하세요.",
    },
  ],
  external_lookup_results: [],
  degraded: false,
  report_url: "/report/scan_123",
};

describe("chatbot helpers", () => {
  it("builds a welcome message from the current scan state", () => {
    expect(buildChatWelcomeMessage(payload, scanResult)).toContain("현재 위험도는 낮음");
  });

  it("returns contextual suggested prompts", () => {
    expect(buildSuggestedPrompts(payload, scanResult)).toContain("신뢰지표를 요약해줘");
  });

  it("answers a risk question from scan results", () => {
    expect(
      buildAssistantReply({
        payload,
        scanResult,
        prompt: "왜 위험한가요?",
      }),
    ).toContain("콘서트");
  });

  it("answers a trust-signal question and includes rating first", () => {
    const reply = buildAssistantReply({
      payload,
      scanResult,
      prompt: "신뢰지표를 요약해줘",
    });

    expect(reply).toContain("별점: 4.9");
    expect(reply).toContain("거래내역: 44");
  });

  it("answers a seller summary question with seller info instead of risk summary", () => {
    const reply = buildAssistantReply({
      payload: {
        ...payload,
        platform: "joonggonara",
        seller: {
          seller_id: "12236509",
          nickname: "고상한사고견과류",
        },
      },
      scanResult,
      prompt: "판매자 정보를 요약해줘",
    });

    expect(reply).toContain("판매자: 고상한사고견과류");
    expect(reply).not.toContain("현재 위험도는");
  });

  it("explains similar cases without temporary demo wording", () => {
    const reply = buildAssistantReply({
      payload,
      scanResult: {
        ...scanResult,
        similar_cases: [
          {
            case_id: "case_1",
            score: 0.82,
            summary: "오픈채팅 이동 후 선입금을 요구한 티켓 거래 사례",
          },
        ],
      },
      prompt: "유사 사례를 알려줘",
    });

    expect(reply).toContain("현재 스캔 결과와 가장 가까운 유사 사례입니다.");
    expect(reply).toContain("오픈채팅 이동 후 선입금을 요구한 티켓 거래 사례");
    expect(reply).not.toContain("임시 데이터");
  });
});
