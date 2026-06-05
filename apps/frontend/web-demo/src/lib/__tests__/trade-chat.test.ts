import { describe, expect, it } from "vitest";

import {
  buildTradeChatScanPayload,
  parseMoney,
  type TradeChatParsedPage,
} from "../../../../shared/trade-chat";

describe("trade chat parser helpers", () => {
  it("parses Korean price text into a number", () => {
    expect(parseMoney("163,000원")).toBe(163000);
    expect(parseMoney("가격 없음")).toBe(0);
  });

  it("builds a backend scan payload from parsed trade chat data", () => {
    const parsed: TradeChatParsedPage = {
      parser_version: "0.1.0",
      platform: "bunjang",
      page_type: "trade-chat",
      page_url: "http://localhost:3000/bunjang-chat.html",
      page_title: "번개장터 채팅 데모",
      product: {
        title: "아이폰 15 프로",
        price: 910000,
        price_text: "910,000원",
        trade_location: "서울 강남구",
      },
      seller: {
        seller_id: "bunjang-seller-1",
        nickname: "빠른거래",
      },
      buyer: {
        nickname: "safe-buyer",
      },
      chat_messages: [
        {
          block_id: "chat-001",
          speaker_role: "seller",
          speaker_name: "빠른거래",
          timestamp: "12:30",
          text: "번개페이는 정산이 늦어서 안 받아요. 케이뱅크 1102-1234-5678로 예약금 먼저 입금해주세요.",
        },
      ],
      source_text_blocks: [],
      parsed_at: "2026-06-01T00:00:00.000Z",
    };

    expect(buildTradeChatScanPayload(parsed)).toEqual({
      platform: "bunjang",
      page_url: "http://localhost:3000/bunjang-chat.html",
      page_title: "아이폰 15 프로",
      price: 910000,
      seller: {
        seller_id: "bunjang-seller-1",
        nickname: "빠른거래",
      },
      content_blocks: [
        {
          block_id: "title",
          text: "아이폰 15 프로",
        },
        {
          block_id: "product-summary",
          text: "아이폰 15 프로 910,000원 서울 강남구",
        },
        {
          block_id: "chat-001",
          text: "번개페이는 정산이 늦어서 안 받아요. 케이뱅크 1102-1234-5678로 예약금 먼저 입금해주세요.",
        },
      ],
      marketplace_signals: [],
    });
  });
});
