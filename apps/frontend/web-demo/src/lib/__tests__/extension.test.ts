import { describe, expect, it } from "vitest";

import {
  getSupportedMarketplacePageStatus,
  getSupportedSafeTicketPageStatus,
  isSupportedMarketplacePage,
  isSupportedSafeTicketPage,
} from "../../../../shared/page-target";

describe("isSupportedMarketplacePage", () => {
  it("accepts supported joongna and bunjang product or chat pages", () => {
    expect(isSupportedMarketplacePage("http://localhost:3000/product/227242032.html")).toBe(true);
    expect(isSupportedMarketplacePage("http://localhost:3000/joongna-chat.html")).toBe(true);
    expect(isSupportedMarketplacePage("http://localhost:3000/bunjang-chat.html")).toBe(true);
    expect(isSupportedMarketplacePage("https://web.joongna.com/product/227242032")).toBe(true);
    expect(isSupportedMarketplacePage("https://web.joongna.com/chat/room-123")).toBe(true);
    expect(isSupportedMarketplacePage("https://m.bunjang.co.kr/products/401504836")).toBe(true);
    expect(isSupportedMarketplacePage("https://m.bunjang.co.kr/talk/room/401504836")).toBe(true);
  });

  it("rejects unrelated pages", () => {
    expect(isSupportedMarketplacePage("http://localhost:3000/")).toBe(false);
    expect(isSupportedMarketplacePage("https://example.com/product/227242032")).toBe(false);
  });
});

describe("getSupportedMarketplacePageStatus", () => {
  it("returns a ready status message for supported pages", () => {
    expect(getSupportedMarketplacePageStatus("https://m.bunjang.co.kr/products/401504836")).toEqual({
      supported: true,
      label: "지원되는 페이지에서 패널이 동작하고 있습니다.",
    });
  });

  it("returns a guidance message for unsupported pages", () => {
    expect(getSupportedMarketplacePageStatus("http://localhost:3000/")).toEqual({
      supported: false,
      label: "중고나라 또는 번개장터 상품 상세/채팅 페이지를 열면 패널이 자동으로 나타납니다.",
    });
  });
});

describe("feature-compatible safe-ticket aliases", () => {
  it("keeps unified extension helper names wired to marketplace support", () => {
    expect(isSupportedSafeTicketPage("http://localhost:3000/joongna-chat.html")).toBe(true);
    expect(getSupportedSafeTicketPageStatus("http://localhost:3000/bunjang-chat.html")).toEqual({
      supported: true,
      label: "지원되는 페이지에서 패널이 동작하고 있습니다.",
    });
  });
});
