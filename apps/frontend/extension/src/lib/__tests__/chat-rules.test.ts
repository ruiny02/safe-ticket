import { describe, expect, it } from "vitest";

import {
  buildLocalChatHighlightTargets,
  mergeHighlightTargets,
} from "../chat-rules";
import type { ScanCreateRequest, ScanHighlightTarget } from "../../../../shared/types";

describe("chat rule highlights", () => {
  const payload: ScanCreateRequest = {
    platform: "bunjang",
    page_url: "http://localhost:3000/bunjang-chat.html",
    page_title: "번개장터 채팅 데모",
    price: 910000,
    seller: {
      seller_id: "seller-1",
      nickname: "빠른거래",
    },
    content_blocks: [
      {
        block_id: "chat-001",
        text: "번개페이는 정산이 늦어서 안 받아요. 케이뱅크 1102-1234-5678로 예약금 먼저 입금해주세요.",
      },
    ],
    marketplace_signals: [],
  };

  it("detects local chat risk phrases", () => {
    const targets = buildLocalChatHighlightTargets(payload);

    expect(targets.map((target) => target.reason_code)).toEqual([
      "avoid_safe_payment",
      "prepayment_pressure",
      "savings_account_pattern",
    ]);
    expect(targets.map((target) => target.matched_text)).toContain("케이뱅크 1102-1234-5678");
  });

  it("deduplicates backend and local targets", () => {
    const backendTarget: ScanHighlightTarget = {
      block_id: "chat-001",
      start: 0,
      end: 4,
      matched_text: "예약금",
      reason_code: "prepayment_pressure",
      reason: "선입금 요구",
      css_class: "safe-ticket-highlight-danger",
    };

    expect(mergeHighlightTargets([backendTarget], [backendTarget])).toEqual([backendTarget]);
  });
});
