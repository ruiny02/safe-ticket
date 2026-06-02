import type { ScanCreateRequest } from "./types";
import {
  buildFallbackSellerId,
  buildMarketplaceSignalsBlock,
  cleanMultiline,
  decodeFieldText,
  extractChatBlocks,
  extractProductJsonLd,
  fallbackMatch,
  matchOrThrow,
  normalizeInlineText,
  normalizeMarketplaceSignals,
  parseMoney,
} from "./parser-utils";

function extractProductDetailScript(html: string): string {
  return fallbackMatch(html, /self\.__next_f\.push\(\[1,"22:\[(.*?)<\/script>/s) ?? html;
}

function extractJoongnaMarketplaceSignals(html: string) {
  const trustScore =
    html.match(/신뢰지수<\/span><span[^>]*aria-label="([^"]+)"/)?.[1] ??
    html.match(/신뢰지수[\s\S]{0,120}?aria-label="([^"]+)"/)?.[1];
  const safePaymentCount = html.match(/안심결제<\/span><span[^>]*>([^<]+)<\/span>/)?.[1];
  const reviewCount = html.match(/거래후기<\/span><span[^>]*>([^<]+)<\/span>/)?.[1];
  const favoriteCount = html.match(/단골<\/span><span[^>]*>([^<]+)<\/span>/)?.[1];

  return normalizeMarketplaceSignals([
    {
      key: "trust_score",
      label: "신뢰지수",
      value: normalizeInlineText(trustScore ?? ""),
    },
    {
      key: "safe_payment_count",
      label: "안심결제",
      value: normalizeInlineText(safePaymentCount ?? ""),
    },
    {
      key: "review_count",
      label: "거래후기",
      value: normalizeInlineText(reviewCount ?? ""),
    },
    {
      key: "favorite_count",
      label: "단골",
      value: normalizeInlineText(favoriteCount ?? ""),
    },
  ]);
}

export function isJoongnaChatHtml(html: string, pageUrl: string): boolean {
  return (
    /data-chat-message|data-safe-ticket-chat|jn-chat-drawer/i.test(html) ||
    /\/chat(?:[/?#]|$)|\/messages?(?:[/?#]|$)|[?&](room|chat)/i.test(pageUrl)
  );
}

export function parseJoongnaProductHtml(html: string, pageUrl: string): ScanCreateRequest {
  const source = extractProductDetailScript(html);
  const productJsonLd = extractProductJsonLd(html);
  const marketplaceSignals = extractJoongnaMarketplaceSignals(html);
  const marketplaceSignalsBlock = buildMarketplaceSignalsBlock(marketplaceSignals);

  const titleRaw =
    fallbackMatch(source, /\\"productTitle\\":\\"([\s\S]*?)\\",\\"productDescription\\"/) ??
    productJsonLd?.name ??
    fallbackMatch(html, /<title>([^<]+?) \| [^<]+<\/title>/);
  const sellerId =
    fallbackMatch(source, /\\"storeSeq\\":(\d+)/) ??
    fallbackMatch(html, /href="\/store\/(\d+)"/) ??
    buildFallbackSellerId("joongna-seller", "unknown");
  const sellerNicknameRaw =
    fallbackMatch(source, /\\"nickName\\":\\"([\s\S]*?)\\",\\"productTitle\\"/) ??
    productJsonLd?.offers?.seller?.name ??
    fallbackMatch(html, /text-gray-900">([^<]+)<\/span>/);
  const priceRaw =
    fallbackMatch(source, /\\"productPrice\\":(\d+)/) ??
    (productJsonLd?.offers?.price !== undefined ? String(productJsonLd.offers.price) : undefined) ??
    fallbackMatch(html, /"price":(\d+)/);
  const descriptionRaw =
    fallbackMatch(source, /\\"productDescription\\":\\"([\s\S]*?)\\",\\"qty\\":/) ??
    productJsonLd?.description ??
    fallbackMatch(html, /<p[^>]*whitespace-pre-line[^>]*>([\s\S]*?)<\/p>/);

  const title = titleRaw
    ? cleanMultiline(decodeFieldText(titleRaw))
    : matchOrThrow(html, /<title>([^<]+)<\/title>/, "Joongna title");
  const sellerNickname = sellerNicknameRaw
    ? normalizeInlineText(decodeFieldText(sellerNicknameRaw))
    : "unknown";
  const description = descriptionRaw ? cleanMultiline(decodeFieldText(descriptionRaw)) : "";

  if (!priceRaw) {
    throw new Error("Failed to extract Joongna price");
  }

  return {
    platform: "joonggonara",
    page_url: pageUrl,
    page_title: title,
    price: Number(priceRaw),
    seller: {
      seller_id: sellerId,
      nickname: sellerNickname,
    },
    content_blocks: [
      {
        block_id: "title",
        text: title,
      },
      {
        block_id: "body-1",
        text: description,
      },
      ...(marketplaceSignalsBlock ? [marketplaceSignalsBlock] : []),
    ].filter((block) => block.text.trim().length > 0),
    marketplace_signals: marketplaceSignals,
  };
}

export function parseJoongnaChatHtml(html: string, pageUrl: string): ScanCreateRequest {
  const titleRaw =
    fallbackMatch(html, /data-product-title[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/) ??
    fallbackMatch(html, /<title>([^<]+?) \| [^<]+<\/title>/) ??
    matchOrThrow(html, /<title>([^<]+)<\/title>/, "Joongna chat title");
  const priceTextRaw =
    fallbackMatch(html, /data-product-price[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /<b[^>]*>([\d,\s]+)<\/b>/) ??
    "0";
  const tradeLocationRaw = fallbackMatch(html, /data-trade-location[^>]*>([\s\S]*?)<\/[^>]+>/) ?? "";
  const sellerNameRaw =
    fallbackMatch(html, /data-seller-name[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /jn-chat-title[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/) ??
    "unknown";
  const sellerId =
    fallbackMatch(html, /data-seller-id="([^"]+)"/) ??
    buildFallbackSellerId("joongna-chat-seller", normalizeInlineText(decodeFieldText(sellerNameRaw)));
  const chatBlocks = extractChatBlocks(html, "jn-chat");

  const title = normalizeInlineText(decodeFieldText(titleRaw));
  const priceText = normalizeInlineText(decodeFieldText(priceTextRaw));
  const tradeLocation = normalizeInlineText(decodeFieldText(tradeLocationRaw));
  const sellerNickname = normalizeInlineText(decodeFieldText(sellerNameRaw));
  const marketplaceSignals = normalizeMarketplaceSignals([
    {
      key: "safe_payment",
      label: "안심결제",
      value: /안심결제/.test(html) ? "available" : "",
    },
  ]);
  const marketplaceSignalsBlock = buildMarketplaceSignalsBlock(marketplaceSignals);

  return {
    platform: "joonggonara",
    page_url: pageUrl,
    page_title: title,
    price: parseMoney(priceText),
    seller: {
      seller_id: sellerId,
      nickname: sellerNickname,
    },
    content_blocks: [
      {
        block_id: "title",
        text: title,
      },
      {
        block_id: "product-summary",
        text: [title, priceText, tradeLocation].filter(Boolean).join(" "),
      },
      ...(marketplaceSignalsBlock ? [marketplaceSignalsBlock] : []),
      ...chatBlocks,
    ].filter((block) => block.text.trim().length > 0),
    marketplace_signals: marketplaceSignals,
  };
}

export function parseJoongnaPageHtml(html: string, pageUrl: string): ScanCreateRequest {
  return isJoongnaChatHtml(html, pageUrl)
    ? parseJoongnaChatHtml(html, pageUrl)
    : parseJoongnaProductHtml(html, pageUrl);
}

export function buildScanPayload(parsed: ScanCreateRequest): ScanCreateRequest {
  return parsed;
}
