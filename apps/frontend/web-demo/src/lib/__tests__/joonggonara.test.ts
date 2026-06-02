import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseBunjangChatHtml, parseBunjangPageHtml, parseBunjangProductHtml } from "../../../../shared/bunjang";
import {
  buildScanPayload,
  enhanceJoongnaProductPayloadFromDocument,
  isReliableJoongnaProductPayload,
  parseJoongnaChatHtml,
  parseJoongnaPageHtml,
  parseJoongnaProductHtml,
} from "../../../../shared/joonggonara";
import { parseMarketplacePageHtml } from "../../../../shared/marketplace";

const currentDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const joongnaProductFixturePath = resolve(
  currentDir,
  "../../../../../frontend/demo/joongna-product-demo/product/227242032.html",
);
const joongnaChatFixturePath = resolve(
  currentDir,
  "../../../../../frontend/trade-chat-demo/joongna-chat.html",
);
const bunjangChatFixturePath = resolve(
  currentDir,
  "../../../../../frontend/trade-chat-demo/bunjang-chat.html",
);

describe("parseJoongnaProductHtml", () => {
  it("extracts product fields and marketplace signals from joongna html", () => {
    const html = readFileSync(joongnaProductFixturePath, "utf-8");
    const parsed = parseJoongnaProductHtml(html, "http://localhost:3000/product/227242032.html");

    expect(parsed.platform).toBe("joonggonara");
    expect(parsed.page_title.length).toBeGreaterThan(3);
    expect(parsed.price).toBe(163000);
    expect(parsed.seller).toEqual({
      seller_id: "4099087",
      nickname: "낭닥SJ",
    });
    expect(parsed.marketplace_signals).toEqual([
      expect.objectContaining({ key: "trust_score", value: "306점" }),
      expect.objectContaining({ key: "safe_payment_count", value: "0" }),
      expect.objectContaining({ key: "review_count", value: "0" }),
      expect.objectContaining({ key: "favorite_count", value: "0" }),
    ]);
    expect(parsed.content_blocks[1].text).toContain("3355-28-8620726");
    expect(parsed.content_blocks.some((block) => block.block_id === "marketplace-signals")).toBe(true);
  });

  it("falls back to JSON-LD and store links on live-like html", () => {
    const html = `
      <html>
        <head>
          <title>I.O.I Concert Ticket | 중고나라</title>
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Product","name":"I.O.I Concert Ticket","description":"2026 I.O.I Concert Tour: LOOP in SEOUL","offers":{"price":161000,"seller":{"@type":"Person","name":"AcesHigh"}}}
          </script>
        </head>
        <body>
          <a href="/store/2474236">가게 정보</a>
        </body>
      </html>
    `;

    const parsed = parseJoongnaProductHtml(html, "https://web.joongna.com/product/229043402");

    expect(parsed.page_title).toContain("I.O.I Concert Ticket");
    expect(parsed.price).toBe(161000);
    expect(parsed.seller).toEqual({
      seller_id: "2474236",
      nickname: "AcesHigh",
    });
    expect(parsed.marketplace_signals).toEqual([]);
    expect(parsed.content_blocks[1].text).toContain("2026 I.O.I Concert Tour: LOOP in SEOUL");
  });

  it("uses visible DOM values to replace unreliable reload fallbacks", () => {
    const payload = {
      platform: "joonggonara" as const,
      page_url: "https://web.joongna.com/product/227242032",
      page_title: "tuki. 츠키 아시아투어콘서트 정가*~-",
      price: 5070,
      seller: {
        seller_id: "joongna-seller-unknown",
        nickname: "결제 혜택",
      },
      content_blocks: [
        { block_id: "title", text: "tuki. 츠키 아시아투어콘서트 정가*~-" },
        { block_id: "body-1", text: "본문" },
      ],
      marketplace_signals: [],
    };
    const sellerSpan = {
      textContent: "낭닥SJ",
    };
    const sellerAnchor = {
      getAttribute: (name: string) => (name === "href" ? "/store/4099087" : null),
      querySelector: () => sellerSpan,
    };
    const document = {
      querySelector: (selector: string) =>
        selector === "h1"
          ? {
              textContent: "tuki. 츠키 아시아투어콘서트 정가*~-",
            }
          : null,
      querySelectorAll: (selector: string) => {
        if (selector.includes("font-bold")) {
          return [
            {
              textContent: "163,000원",
            },
          ];
        }

        if (selector.includes('a[href^="/store/"]')) {
          return [sellerAnchor];
        }

        return [];
      },
    } as unknown as Document;

    const enhanced = enhanceJoongnaProductPayloadFromDocument(document, payload);

    expect(enhanced.price).toBe(163000);
    expect(enhanced.seller).toEqual({
      seller_id: "4099087",
      nickname: "낭닥SJ",
    });
    expect(isReliableJoongnaProductPayload(enhanced)).toBe(true);
  });
});

describe("parseJoongnaChatHtml", () => {
  it("extracts product summary, chat messages, and visible trust signals", () => {
    const html = readFileSync(joongnaChatFixturePath, "utf-8");
    const parsed = parseJoongnaChatHtml(html, "http://localhost:3000/joongna-chat.html");

    expect(parsed.platform).toBe("joonggonara");
    expect(parsed.page_title.length).toBeGreaterThan(3);
    expect(parsed.price).toBe(215000);
    expect(parsed.seller).toEqual({
      seller_id: "store-463",
      nickname: "similis",
    });
    expect(parsed.marketplace_signals).toEqual([
      expect.objectContaining({ key: "safe_payment", value: "available" }),
    ]);
    expect(parsed.content_blocks.some((block) => block.block_id === "jn-chat-004")).toBe(true);
    expect(parsed.content_blocks.at(-1)?.text).toContain("304-1234-5678-90");
  });

  it("auto-detects joongna chat pages from html and url", () => {
    const html = readFileSync(joongnaChatFixturePath, "utf-8");
    const parsed = parseJoongnaPageHtml(html, "https://web.joongna.com/chat/room-123");

    expect(parsed.marketplace_signals).toEqual([
      expect.objectContaining({ key: "safe_payment", value: "available" }),
    ]);
    expect(parsed.content_blocks.some((block) => block.block_id === "jn-chat-004")).toBe(true);
  });
});

describe("parseBunjangProductHtml", () => {
  it("extracts live-like product fields and marketplace signals from bunjang html", () => {
    const html = `
      <html>
        <body>
          <div class="_container_15v9v_1">
            <span class="Typography_typography__1wr8iu13 Typography_typography_variant_T4__1wr8iu17 _productName_15v9v_11">하나비 콘서트 티켓 양도</span>
            <span class="Typography_typography__1wr8iu13 Typography_typography_variant_T2__1wr8iu15">270,000원</span>
            <p class="_description_15uwa_1">R석 1매 양도합니다.</p>
            <div>배송비 <span>일반 10,000원</span> 구매하기</div>
            <div class="_shopProfileSection_15v9v_24">
              <span class="Typography_typography__1wr8iu13 Typography_typography_variant_T4__1wr8iu17">총알클로버</span>
              <span class="Typography_typography__1wr8iu13 Typography_typography_variant_L8__1wr8iu1u">후기 11</span>
              <span class="Typography_typography__1wr8iu13 Typography_typography_variant_L8__1wr8iu1u">거래내역 44</span>
            </div>
          </div>
        </body>
      </html>
    `;

    const parsed = parseBunjangProductHtml(html, "https://m.bunjang.co.kr/products/401504836");

    expect(parsed.platform).toBe("bunjang");
    expect(parsed.page_title).toContain("하나비 콘서트 티켓 양도");
    expect(parsed.price).toBe(270000);
    expect(parsed.seller.nickname).toBe("총알클로버");
    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("review_count");
    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("transaction_count");
  });
});

describe("parseBunjangChatHtml", () => {
  it("extracts product summary, chat messages, and trust signals from bunjang trade chat demo html", () => {
    const html = readFileSync(bunjangChatFixturePath, "utf-8");
    const parsed = parseBunjangChatHtml(html, "http://localhost:3000/bunjang-chat.html");

    expect(parsed.platform).toBe("bunjang");
    expect(parsed.page_title.length).toBeGreaterThan(3);
    expect(parsed.price).toBe(950000);
    expect(parsed.seller.seller_id).toBe("bunjang-user-5158822");
    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("transaction_count");
    expect(parsed.content_blocks.some((block) => block.block_id === "bg-chat-004")).toBe(true);
    expect(parsed.content_blocks.at(-1)?.text).toContain("1102-1234-5678");
  });

  it("auto-detects bunjang chat pages from html and url", () => {
    const html = readFileSync(bunjangChatFixturePath, "utf-8");
    const parsed = parseBunjangPageHtml(html, "https://m.bunjang.co.kr/talk/room/123");

    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("transaction_count");
    expect(parsed.content_blocks.some((block) => block.block_id === "bg-chat-007")).toBe(true);
  });
});

describe("parseMarketplacePageHtml", () => {
  it("routes to the correct marketplace parser", () => {
    const html = readFileSync(bunjangChatFixturePath, "utf-8");
    const parsed = parseMarketplacePageHtml(html, "http://localhost:3000/bunjang-chat.html");

    expect(parsed.platform).toBe("bunjang");
    expect(parsed.seller.seller_id).toBe("bunjang-user-5158822");
  });
});

describe("buildScanPayload", () => {
  it("keeps the scan contract shape expected by POST /api/v1/scans", () => {
    const html = readFileSync(joongnaProductFixturePath, "utf-8");
    const parsed = parseJoongnaProductHtml(html, "https://example.com/post/123");

    expect(buildScanPayload(parsed)).toEqual({
      platform: "joonggonara",
      page_url: "https://example.com/post/123",
      page_title: expect.any(String),
      price: 163000,
      seller: {
        seller_id: "4099087",
        nickname: "낭닥SJ",
      },
      content_blocks: expect.arrayContaining([
        {
          block_id: "title",
          text: expect.any(String),
        },
        {
          block_id: "body-1",
          text: expect.any(String),
        },
        {
          block_id: "marketplace-signals",
          text: expect.stringContaining("신뢰지수: 306점"),
        },
      ]),
      marketplace_signals: [
        expect.objectContaining({ key: "trust_score", value: "306점" }),
        expect.objectContaining({ key: "safe_payment_count", value: "0" }),
        expect.objectContaining({ key: "review_count", value: "0" }),
        expect.objectContaining({ key: "favorite_count", value: "0" }),
      ],
    });
  });
});
