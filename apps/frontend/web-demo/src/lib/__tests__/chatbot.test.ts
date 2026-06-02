import { describe, expect, it } from "vitest";

import type { ScanCreateRequest, ScanResultResponse } from "../../../../shared/types";
import { buildAssistantReply, buildChatWelcomeMessage } from "../chatbot";

const payload: ScanCreateRequest = {
  platform: "joonggonara",
  page_url: "https://web.joongna.com/product/227242032",
  page_title: "Concert ticket",
  price: 163000,
  seller: {
    seller_id: "4099087",
    nickname: "sellerSJ",
  },
  content_blocks: [],
  marketplace_signals: [],
};

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
  external_lookup_results: [],
  degraded: false,
  report_url: "/report/scan_123",
};

describe("chatbot helpers", () => {
  it("builds a welcome message from the current scan state", () => {
    expect(buildChatWelcomeMessage(payload, scanResult)).toContain("현재 위험도");
  });

  it("answers a risk question from scan results", () => {
    expect(
      buildAssistantReply({
        payload,
        scanResult,
        prompt: "Why is this risky?",
      }),
    ).toContain("KakaoBank");
  });
});
