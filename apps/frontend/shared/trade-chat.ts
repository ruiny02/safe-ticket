import type { MarketplacePlatform, ScanCreateRequest } from "./types";

export interface TradeChatMessage {
  block_id: string;
  speaker_role: string;
  speaker_name: string;
  timestamp: string;
  text: string;
}

export interface TradeChatTextBlock {
  block_id: string;
  source: "chat_message" | "page_field";
  selector: string | undefined;
  text: string;
}

export interface TradeChatParsedPage {
  parser_version: string;
  platform: MarketplacePlatform;
  page_type: string;
  page_url: string;
  page_title: string;
  product: {
    title: string;
    price: number;
    price_text: string;
    trade_location: string;
  };
  seller: {
    seller_id: string;
    nickname: string;
  };
  buyer: {
    nickname: string;
  };
  chat_messages: TradeChatMessage[];
  source_text_blocks: TradeChatTextBlock[];
  parsed_at: string;
}

const PARSER_VERSION = "0.1.0";
const CHAT_ROOT_SELECTOR = "[data-safe-ticket-chat]";
const CHAT_MESSAGE_SELECTOR = "[data-chat-message]";

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMoney(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function getText(selector: string, root: ParentNode): string {
  return normalizeText(root.querySelector(selector)?.textContent);
}

function inferPlatform(root: HTMLElement | null, pageUrl: string): MarketplacePlatform {
  if (root?.dataset.platform === "bunjang" || root?.dataset.platform === "joonggonara") {
    return root.dataset.platform;
  }

  const lowerUrl = pageUrl.toLowerCase();
  if (lowerUrl.includes("bunjang")) {
    return "bunjang";
  }
  if (lowerUrl.includes("joongna") || lowerUrl.includes("joonggonara")) {
    return "joonggonara";
  }

  return "joonggonara";
}

function stableBlockId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function buildContentBlock(blockId: string, text: string) {
  return {
    block_id: blockId,
    text: normalizeText(text),
  };
}

export function buildTradeChatScanPayload(parsed: TradeChatParsedPage): ScanCreateRequest {
  const contentBlocks = [
    buildContentBlock("title", parsed.product.title || parsed.page_title),
    buildContentBlock(
      "product-summary",
      [parsed.product.title, parsed.product.price_text, parsed.product.trade_location].filter(Boolean).join(" "),
    ),
    ...parsed.chat_messages.map((message) => buildContentBlock(message.block_id, message.text)),
  ].filter((block) => block.text);

  return {
    platform: parsed.platform,
    page_url: parsed.page_url,
    page_title: parsed.product.title || parsed.page_title,
    price: parsed.product.price,
    seller: parsed.seller,
    content_blocks: contentBlocks,
    marketplace_signals: [],
  };
}

export function parseTradeChatDocument(documentRef: Document, pageUrl: string): TradeChatParsedPage {
  const root = documentRef.querySelector<HTMLElement>(CHAT_ROOT_SELECTOR);
  const platform = inferPlatform(root, pageUrl);
  const title = getText("[data-product-title]", documentRef) || normalizeText(documentRef.title);
  const priceText = getText("[data-product-price]", documentRef);
  const sellerNode = documentRef.querySelector<HTMLElement>("[data-seller-id]");

  const chatMessages = Array.from(documentRef.querySelectorAll<HTMLElement>(CHAT_MESSAGE_SELECTOR)).map(
    (node, index): TradeChatMessage => ({
      block_id: node.dataset.messageId || stableBlockId("chat", index),
      speaker_role: node.dataset.role || "unknown",
      speaker_name: node.dataset.speaker || "",
      timestamp: node.dataset.timestamp || "",
      text: normalizeText(node.textContent),
    }),
  );

  const readableSelectors = [
    "[data-product-title]",
    "[data-product-price]",
    "[data-trade-location]",
    "[data-seller-name]",
    CHAT_MESSAGE_SELECTOR,
  ];
  const seen = new Set<string>();
  const sourceTextBlocks = Array.from(documentRef.querySelectorAll<HTMLElement>(readableSelectors.join(",")))
    .filter((node) => !node.closest("#safe-ticket-extension-root"))
    .map((node, index): TradeChatTextBlock | null => {
      const text = normalizeText(node.textContent);
      if (!text || seen.has(text)) {
        return null;
      }

      seen.add(text);
      const selector = node.matches(CHAT_MESSAGE_SELECTOR)
        ? CHAT_MESSAGE_SELECTOR
        : readableSelectors.find((candidate) => node.matches(candidate));

      return {
        block_id: node.dataset.messageId || stableBlockId("text", index),
        source: node.matches(CHAT_MESSAGE_SELECTOR) ? "chat_message" : "page_field",
        selector,
        text,
      };
    })
    .filter((block): block is TradeChatTextBlock => block !== null);

  return {
    parser_version: PARSER_VERSION,
    platform,
    page_type: root?.dataset.pageKind || "trade-chat",
    page_url: pageUrl,
    page_title: normalizeText(documentRef.title),
    product: {
      title,
      price: parseMoney(priceText),
      price_text: priceText,
      trade_location: getText("[data-trade-location]", documentRef),
    },
    seller: {
      seller_id: sellerNode?.dataset.sellerId || `${platform}-seller`,
      nickname: getText("[data-seller-name]", documentRef) || "unknown",
    },
    buyer: {
      nickname: getText("[data-buyer-name]", documentRef) || "unknown",
    },
    chat_messages: chatMessages,
    source_text_blocks: sourceTextBlocks,
    parsed_at: new Date().toISOString(),
  };
}

export function parseTradeChatPayload(documentRef: Document, pageUrl: string): ScanCreateRequest {
  return buildTradeChatScanPayload(parseTradeChatDocument(documentRef, pageUrl));
}
