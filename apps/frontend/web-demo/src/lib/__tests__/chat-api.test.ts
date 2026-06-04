import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildChatRequestPayload,
  requestRemoteChatReply,
  type ChatConversationMessage,
} from "../../../../shared/chat-api";
import type { ScanCreateRequest, ScanResultResponse } from "../../../../shared/types";

const payload: ScanCreateRequest = {
  platform: "joonggonara",
  page_url: "https://web.joongna.com/product/227242032",
  page_title: "테스트 상품",
  price: 100000,
  seller: {
    seller_id: "seller-1",
    nickname: "테스트판매자",
  },
  content_blocks: [],
  marketplace_signals: [],
};

const scanResult: ScanResultResponse = {
  scan_id: "scan_123",
  status: "completed",
  risk_level: "medium",
  risk_score: 0.45,
  summary: "테스트 요약",
  risk_tags: [],
  evidence_items: [],
  highlight_targets: [],
  similar_cases: [],
  recommended_actions: [],
  external_lookup_results: [],
  degraded: false,
  report_url: "/report/scan_123",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chat-api helpers", () => {
  it("builds a chat payload with listing and scan context", () => {
    const messages: ChatConversationMessage[] = [
      { role: "assistant", text: "무엇을 도와드릴까요?" },
      { role: "user", text: "왜 위험한가요?" },
    ];

    expect(
      buildChatRequestPayload({
        messages,
        pageUrl: payload.page_url,
        payload,
        prompt: "왜 위험한가요?",
        scanResult,
      }),
    ).toEqual({
      prompt: "왜 위험한가요?",
      page_url: payload.page_url,
      scan_id: "scan_123",
      listing: payload,
      scan_result: scanResult,
      messages,
    });
  });

  it("returns a remote reply when a backend chat response exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ reply: "백엔드 응답입니다." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestRemoteChatReply("https://example.com", {
      prompt: "테스트",
      page_url: payload.page_url,
      scan_id: scanResult.scan_id,
      listing: payload,
      scan_result: scanResult,
      messages: [],
    });

    expect(result.source).toBe("remote");
    expect(result.reply).toBe("백엔드 응답입니다.");
    expect(result.endpoint).toContain("/api/v1/chat/reply");
  });

  it("falls back to local mode when the backend chat endpoint is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestRemoteChatReply("https://example.com", {
      prompt: "테스트",
      page_url: payload.page_url,
      scan_id: scanResult.scan_id,
      listing: payload,
      scan_result: scanResult,
      messages: [],
    });

    expect(result.source).toBe("local");
    expect(result.reply).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.com/api/v1/chat/reply",
      "https://example.com/api/v1/chat",
      "https://example.com/api/v1/assistant/chat",
    ]);
  });
});
