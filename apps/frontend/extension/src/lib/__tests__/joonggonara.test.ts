import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  enhanceBunjangProductPayloadFromDocument,
  parseBunjangChatHtml,
  parseBunjangPageHtml,
  parseBunjangProductHtml,
} from "../../../../shared/bunjang";
import { extractChatBlocksFromDocument } from "../../../../shared/parser-utils";
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
      profile_url: "https://web.joongna.com/store/4099087",
    });
    expect(parsed.marketplace_signals).toEqual([
      expect.objectContaining({ key: "trust_score", value: "306점" }),
      expect.objectContaining({ key: "safe_payment_count", value: "0" }),
      expect.objectContaining({ key: "review_count", value: "0" }),
      expect.objectContaining({ key: "favorite_count", value: "0" }),
    ]);
    expect(parsed.content_blocks[1].text).toContain("3355-28-8620726");
    expect(parsed.content_blocks.some((block) => block.block_id === "marketplace-signals")).toBe(false);
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
      profile_url: "https://web.joongna.com/store/2474236",
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
      profile_url: "https://web.joongna.com/store/4099087",
    });
    expect(isReliableJoongnaProductPayload(enhanced)).toBe(true);
  });

  it("hydrates visible trust signals from live DOM text", () => {
    const payload = {
      platform: "joonggonara" as const,
      page_url: "https://web.joongna.com/product/227242032",
      page_title: "테스트 상품",
      price: 163000,
      seller: {
        seller_id: "4099087",
        nickname: "낭닥SJ",
        profile_url: "https://web.joongna.com/store/4099087",
      },
      content_blocks: [
        { block_id: "title", text: "테스트 상품" },
        { block_id: "body-1", text: "본문" },
      ],
      marketplace_signals: [],
    };
    const document = {
      body: {
        innerText: "신뢰지수 403 안심결제 0 거래후기 0 단골 1",
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: {
        outerHTML: "",
      },
    } as unknown as Document;

    const enhanced = enhanceJoongnaProductPayloadFromDocument(document, payload);

    expect(enhanced.marketplace_signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "trust_score", value: "403" }),
        expect.objectContaining({ key: "safe_payment_count", value: "0" }),
        expect.objectContaining({ key: "review_count", value: "0" }),
        expect.objectContaining({ key: "favorite_count", value: "1" }),
      ]),
    );
    expect(enhanced.marketplace_signals.some((signal) => signal.key === "safe_payment")).toBe(false);
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
      profile_url: "https://web.joongna.com/store/463",
    });
    expect(parsed.marketplace_signals.some((signal) => signal.key === "safe_payment")).toBe(false);
    expect(parsed.content_blocks.some((block) => block.block_id === "jn-chat-004")).toBe(true);
    expect(parsed.content_blocks.at(-1)?.text).toContain("304-1234-5678-90");
    expect(parsed.content_blocks.every((block) => /^jn-chat-\d+$/i.test(block.block_id))).toBe(true);
  });

  it("auto-detects joongna chat pages from html and url", () => {
    const html = readFileSync(joongnaChatFixturePath, "utf-8");
    const parsed = parseJoongnaPageHtml(html, "https://web.joongna.com/chat/room-123");

    expect(parsed.marketplace_signals.some((signal) => signal.key === "safe_payment")).toBe(false);
    expect(parsed.content_blocks.some((block) => block.block_id === "jn-chat-004")).toBe(true);
  });

  it("extracts visible review and favorite trust signals from joongna chat html", () => {
    const html = `
      <html>
        <body>
          <div data-chat-message data-message-id="jn-chat-001">안심결제 말고 계좌이체 가능해요.</div>
          <div data-product-title>중고나라 티켓 양도</div>
          <div data-product-price>150,000원</div>
          <div data-seller-name>ticketSeller</div>
          <div data-seller-id="store-12"></div>
          <span>안심결제</span><span>가능</span>
          <span>거래후기</span><span>18</span>
          <span>단골</span><span>7</span>
        </body>
      </html>
    `;

    const parsed = parseJoongnaChatHtml(html, "https://web.joongna.com/chat/room-12");

    expect(parsed.marketplace_signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "safe_payment_count", value: "가능" }),
        expect.objectContaining({ key: "review_count", value: "18" }),
        expect.objectContaining({ key: "favorite_count", value: "7" }),
      ]),
    );
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
              <a href="/shops/5158822">상점정보</a>
              <span class="Typography_typography__1wr8iu13 Typography_typography_variant_T4__1wr8iu17">총알클로버</span>
              <span>별점 4.9</span>
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
    expect(parsed.seller.profile_url).toBe("https://m.bunjang.co.kr/shops/5158822");
    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("seller_rating");
    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("review_count");
    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("transaction_count");
  });

  it("extracts a live bunjang seller name from a visible Typography T4 span", () => {
    const html = `
      <html>
        <head><title>번개장터 티켓</title></head>
        <body>
          <span class="Typography_typography__1wr8iu13 Typography_typography_variant_T4__1wr8iu17 _productName_15v9v_11">세븐틴 콘서트 티켓</span>
          <span class="Typography_typography__1wr8iu13 Typography_typography_variant_T2__1wr8iu15">120,000원</span>
          <p class="_description_15uwa_1">중콘 1매 양도합니다.</p>
          <a href="/shops/5158822">상점정보</a>
          <span class="Typography_typography__1wr8iu13 Typography_typography_variant_T4__1wr8iu17" style="--colorVariants__1wr8iu10: #191919;">냠냠씽씽</span>
          <span>후기 13</span>
        </body>
      </html>
    `;

    const parsed = parseBunjangProductHtml(html, "https://m.bunjang.co.kr/products/401504836");

    expect(parsed.seller.nickname).toBe("냠냠씽씽");
    expect(parsed.seller.profile_url).toBe("https://m.bunjang.co.kr/shops/5158822");
    expect(parsed.marketplace_signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "review_count", value: "13" })]),
    );
  });

  it("hydrates bunjang rating and satisfaction signals from visible DOM text", () => {
    const payload = {
      platform: "bunjang" as const,
      page_url: "https://m.bunjang.co.kr/products/401504836",
      page_title: "번개장터 상품",
      price: 270000,
      seller: {
        seller_id: "bunjang-seller-1",
        nickname: "팡팡파라파라팡팡팡s",
      },
      content_blocks: [
        { block_id: "title", text: "번개장터 상품" },
        { block_id: "body-1", text: "본문" },
      ],
      marketplace_signals: [
        { key: "review_count", label: "후기", value: "1" },
        { key: "transaction_count", label: "거래내역", value: "1" },
      ],
    };
    const document = {
      body: {
        innerText: "팡팡파라파라팡팡팡s ⭐ 5 · 후기 1 · 거래내역 1 5 ★★★★★ 100% 만족후기",
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: {
        outerHTML: "",
      },
    } as unknown as Document;

    const enhanced = enhanceJoongnaProductPayloadFromDocument(document, payload);

    expect(enhanced.marketplace_signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "seller_rating", value: "5" }),
        expect.objectContaining({ key: "review_count", value: "1" }),
        expect.objectContaining({ key: "transaction_count", value: "1" }),
        expect.objectContaining({ key: "satisfaction_count", value: "100%" }),
      ]),
    );
  });

  it("hydrates live bunjang product title, price, and seller from rendered DOM", () => {
    const payload = {
      platform: "bunjang" as const,
      page_url: "https://m.bunjang.co.kr/products/401504836",
      page_title: "번개장터",
      price: 0,
      seller: {
        seller_id: "bunjang-seller-unknown",
        nickname: "unknown",
      },
      content_blocks: [{ block_id: "title", text: "번개장터" }],
      marketplace_signals: [],
    };
    const titleNode = {
      textContent: "샤이니 콘서트 티켓 양도",
      getAttribute: (name: string) => (name === "class" ? "_productName_15v9v_11 Typography_typography_variant_T4__1wr8iu17" : ""),
    };
    const priceNode = {
      textContent: "130,000원",
      getAttribute: (name: string) => (name === "class" ? "Typography_typography_variant_T2__1wr8iu15" : ""),
    };
    const sellerNode = {
      textContent: "냠냠씽씽",
      getAttribute: (name: string) => (name === "class" ? "Typography_typography_variant_T4__1wr8iu17" : ""),
    };
    const sellerAnchor = {
      textContent: "상점정보",
      getAttribute: (name: string) => (name === "href" ? "/shops/5158822" : ""),
    };
    const document = {
      body: {
        innerText: "샤이니 콘서트 티켓 양도\n130,000원\n냠냠씽씽\n후기 13",
      },
      querySelector: (selector: string) => {
        if (selector.includes("_productName_")) {
          return titleNode;
        }
        if (selector.includes("_description_")) {
          return null;
        }
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector.includes("Typography_typography_variant_T2") || selector.includes("Typography_typography_variant_S1")) {
          return [priceNode];
        }
        if (selector.includes("Typography_typography_variant_T4")) {
          return [titleNode, sellerNode];
        }
        if (selector.includes("/shops/") || selector.includes("/shop/")) {
          return [sellerAnchor];
        }
        return [];
      },
      documentElement: {
        outerHTML: "",
      },
    } as unknown as Document;

    const enhanced = enhanceBunjangProductPayloadFromDocument(document, payload);

    expect(enhanced.page_title).toBe("샤이니 콘서트 티켓 양도");
    expect(enhanced.price).toBe(130000);
    expect(enhanced.seller.nickname).toBe("냠냠씽씽");
    expect(enhanced.seller.seller_id).toBe("5158822");
    expect(enhanced.seller.profile_url).toBe("https://m.bunjang.co.kr/shops/5158822");
    expect(enhanced.marketplace_signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "review_count", value: "13" })]),
    );
  });

  it("hydrates bunjang profile URL from rendered review statistics resource URL", () => {
    const payload = {
      platform: "bunjang" as const,
      page_url: "https://m.bunjang.co.kr/products/411942584",
      page_title: "DAY6 데이식스 앙콘 콘서트첫콘 S6 2n번 양도",
      price: 1200000,
      seller: {
        seller_id: "bunjang-seller-%EC%A7%80%EA%B5%AC%EB%B3%84123",
        nickname: "지구별123",
      },
      content_blocks: [{ block_id: "title", text: "DAY6 데이식스 앙콘 콘서트첫콘 S6 2n번 양도" }],
      marketplace_signals: [],
    };
    const sellerNode = {
      textContent: "지구별123",
      getAttribute: (name: string) => (name === "class" ? "Typography_typography_variant_T4__1wr8iu17" : ""),
    };
    const document = {
      body: {
        innerText: "지구별123\n5\n・\n후기 22\n・\n거래내역 59",
      },
      defaultView: {
        performance: {
          getEntriesByType: (type: string) =>
            type === "resource"
              ? [
                  {
                    name: "https://api.bunjang.co.kr/api/review/v2/users/84036735/reviews-statistics",
                  },
                ]
              : [],
        },
      },
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector.includes("Typography_typography_variant_T4")) {
          return [sellerNode];
        }
        return [];
      },
      documentElement: {
        outerHTML: "",
      },
    } as unknown as Document;

    const enhanced = enhanceBunjangProductPayloadFromDocument(document, payload);

    expect(enhanced.seller.seller_id).toBe("84036735");
    expect(enhanced.seller.profile_url).toBe("https://m.bunjang.co.kr/shops/84036735");
  });

  it("hydrates live chat messages from rendered bunjang chat DOM", () => {
    const payload = {
      platform: "bunjang" as const,
      page_url: "https://m.bunjang.co.kr/talk/room/123",
      page_title: "번개장터 채팅",
      price: 950000,
      seller: {
        seller_id: "bunjang-user-1",
        nickname: "냥냥냥냥",
      },
      content_blocks: [
        { block_id: "title", text: "번개장터 채팅" },
        { block_id: "product-summary", text: "번개장터 채팅 950,000원 서울 직거래" },
      ],
      marketplace_signals: [],
    };
    const messageElements = [
      {
        isConnected: true,
        dataset: {},
        textContent: "번개페이는 정산이 늦어서 안 받아요.",
        closest: () => null,
        querySelector: () => null,
        getAttribute: () => null,
      },
      {
        isConnected: true,
        dataset: {},
        textContent: "지금 문의가 많아서 5만원 예약금 먼저 입금 주세요.",
        closest: () => null,
        querySelector: () => null,
        getAttribute: () => null,
      },
      {
        isConnected: true,
        dataset: {},
        textContent: "케이뱅크 1102-1234-5678 박지훈입니다.",
        closest: () => null,
        querySelector: () => null,
        getAttribute: () => null,
      },
    ];
    const document = {
      body: {
        innerText: "",
      },
      querySelector: () => null,
      querySelectorAll: (selector: string) => (selector.includes("bubble") || selector.includes("message") ? messageElements : []),
      documentElement: {
        outerHTML: "",
      },
    } as unknown as Document;

    const enhanced = enhanceJoongnaProductPayloadFromDocument(document, payload);

    expect(enhanced.content_blocks.some((block) => block.text.includes("번개페이는 정산이 늦어서 안 받아요."))).toBe(true);
    expect(
      enhanced.content_blocks.some((block) => block.text.includes("지금 문의가 많아서 5만원 예약금 먼저 입금 주세요.")),
    ).toBe(true);
    expect(enhanced.content_blocks.some((block) => block.text.includes("케이뱅크 1102-1234-5678 박지훈입니다."))).toBe(true);
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
    expect(parsed.seller.profile_url).toBe("https://m.bunjang.co.kr/shops/5158822");
    expect(parsed.marketplace_signals.map((signal) => signal.key)).toContain("transaction_count");
    expect(parsed.content_blocks.some((block) => block.block_id === "bg-chat-004")).toBe(true);
    expect(parsed.content_blocks.at(-1)?.text).toContain("1102-1234-5678");
    expect(parsed.content_blocks.every((block) => /^bg-chat-\d+$/i.test(block.block_id))).toBe(true);
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

describe("extractChatBlocksFromDocument", () => {
  it("ignores demo chat notices and keeps only buyer or seller messages", () => {
    const createElement = (text: string, options?: { messageId?: string; matchesExplicit?: boolean }) => ({
      isConnected: true,
      dataset: options?.messageId ? { messageId: options.messageId } : {},
      textContent: text,
      closest: (selector: string) => (selector === "#safe-ticket-extension-root" ? null : null),
      querySelector: () => null,
      getAttribute: (name: string) => (name === "data-message-id" ? options?.messageId ?? null : null),
      matches: (selector: string) => Boolean(options?.matchesExplicit && selector.includes("[data-chat-message]")),
    });

    const elements = [
      createElement("안심결제 쓰고 사기 걱정 없는 중고거래"),
      createElement("중고나라 채팅, 안심결제가 가장 안전합니다!"),
      createElement("상품 아직 있나요?", { messageId: "jn-chat-001", matchesExplicit: true }),
      createElement("네, 아직 있습니다.", { messageId: "jn-chat-002", matchesExplicit: true }),
      createElement("앱에서는 채팅 응답이 더 빠르고 편리합니다. 지금 설치하면 거래 확률을 높일 수 있어요!"),
    ];
    const documentRef = {
      querySelectorAll: () => elements,
    } as unknown as Document;

    const blocks = extractChatBlocksFromDocument(documentRef, "jn-chat");

    expect(blocks).toEqual([
      { block_id: "jn-chat-001", text: "상품 아직 있나요?" },
      { block_id: "jn-chat-002", text: "네, 아직 있습니다." },
    ]);
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
        profile_url: "https://web.joongna.com/store/4099087",
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
      ]),
      marketplace_signals: [
        expect.objectContaining({ key: "trust_score", value: "306점" }),
        expect.objectContaining({ key: "safe_payment_count", value: "0" }),
        expect.objectContaining({ key: "review_count", value: "0" }),
        expect.objectContaining({ key: "favorite_count", value: "0" }),
      ],
    });
    expect(parsed.content_blocks.some((block) => block.block_id === "marketplace-signals")).toBe(false);
  });
});
