import type { ScanCreateRequest } from "./types";
import {
  buildFallbackSellerId,
  cleanMultiline,
  decodeFieldText,
  extractChatBlocks,
  extractProductJsonLd,
  fallbackMatch,
  matchOrThrow,
  normalizeInlineText,
  normalizeMarketplaceSignals,
  parseMoney,
  readMetaContent,
} from "./parser-utils";

const BUNJANG_CHAT_URL_PATTERN = /\/(?:talk|chat|message)(?:[/?#]|$)|[?&](room|chat)/i;

function isGenericBunjangTitle(title: string | undefined): boolean {
  if (!title) {
    return true;
  }

  const normalized = normalizeInlineText(title);
  return !normalized || normalized === "번개장터";
}

function extractBunjangTitle(html: string): string {
  const visibleTitle =
    fallbackMatch(html, /<span[^>]*_productName_[^"]*"[^>]*>([^<]+)<\/span>/) ??
    fallbackMatch(html, /<span[^>]*Typography_typography_variant_B3[^"]*"[^>]*>([^<]+)<\/span>/);
  const metaTitle = readMetaContent(html, "property", "og:title");
  const title = isGenericBunjangTitle(visibleTitle)
    ? isGenericBunjangTitle(metaTitle)
      ? undefined
      : metaTitle
    : visibleTitle;

  return title
    ? normalizeInlineText(decodeFieldText(title))
    : matchOrThrow(html, /<title>([^<]+)<\/title>/, "Bunjang title");
}

function extractBunjangPriceText(html: string): string {
  return (
    fallbackMatch(html, /<span[^>]*Typography_typography_variant_T2[^"]*"[^>]*>([\d,]+)원<\/span>/) ??
    fallbackMatch(html, /<span[^>]*Typography_typography_variant_S1[^"]*"[^>]*>([\d,]+)원<\/span>/) ??
    fallbackMatch(html, />([\d,]{2,})원<\/span>/) ??
    "0"
  );
}

function extractBunjangDescription(html: string): string {
  const raw =
    fallbackMatch(html, /<p[^>]*_description_[^"]*"[^>]*>([\s\S]*?)<\/p>/) ??
    fallbackMatch(html, /상품 설명[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);

  return raw ? cleanMultiline(decodeFieldText(raw)) : "";
}

function extractBunjangSellerNickname(html: string): string {
  const shopSection = fallbackMatch(html, /(<div[^>]*_shopProfileSection_[^"]*"[\s\S]*?<\/div>\s*<\/div>)/);
  const raw =
    (shopSection
      ? fallbackMatch(shopSection, /<span[^>]*Typography_typography_variant_T4[^"]*"[^>]*>([^<]+)<\/span>/)
      : undefined) ??
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>\s*<p>/) ??
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>/);

  return raw ? normalizeInlineText(decodeFieldText(raw)) : "unknown";
}

function extractBunjangSellerId(html: string, sellerNickname: string): string {
  const explicitId =
    fallbackMatch(html, /\/shops\/(\d+)/) ??
    html.match(/"(?:shopId|storeId|sellerId|memberId|userId)"\s*:\s*"?(\\?\d{4,})"?/i)?.[1]?.replace(/\\/g, "");

  return explicitId ?? buildFallbackSellerId("bunjang-seller", sellerNickname);
}

function extractBunjangMarketplaceSignals(html: string) {
  const extractCount = (pattern: RegExp): string | undefined => html.match(pattern)?.[1];
  const extractJsonNumber = (fieldName: string): string | undefined =>
    html.match(new RegExp(`"${fieldName}"\\s*:\\s*"?(\\\\?\\d[\\d.,]*)"?`, "i"))?.[1]?.replace(/\\/g, "");
  const rating =
    html.match(/⭐\s*([0-9.]+)/)?.[1] ??
    html.match(/★\s*([0-9.]+)/)?.[1] ??
    html.match(/(?:별점|평점|rating)[\s:]*([0-9.]+)/i)?.[1] ??
    html.match(/aria-label="(?:별점|평점|rating)\s*([0-9.]+)"/i)?.[1] ??
    html.match(/<strong[^>]*>\s*([0-9.]+)\s*<\/strong>\s*<span[^>]*>\s*(?:별점|평점)/i)?.[1] ??
    extractJsonNumber("sellerRating") ??
    extractJsonNumber("rating") ??
    extractJsonNumber("reviewAverage");
  const satisfactionCount =
    extractCount(/만족후기[\s:]*([0-9,]+)/) ??
    extractCount(/만족 후기[\s:]*([0-9,]+)/) ??
    extractCount(/([0-9]{1,3}%?)\s*만족후기/);
  const reviewCount =
    extractCount(/(?:전체\s*)?후기[\s:]*([0-9,]+)/) ??
    extractCount(/reviewCount"\s*:\s*"?(\\?\d[\d,]*)"?/i)?.replace(/\\/g, "");
  const transactionCount =
    extractCount(/거래(?:내역|횟수)[\s:]*([0-9,]+)/) ??
    extractCount(/지금까지\s*([0-9,]+)개의 상품을 판매했어요/) ??
    extractCount(/transactionCount"\s*:\s*"?(\\?\d[\d,]*)"?/i)?.replace(/\\/g, "");

  return normalizeMarketplaceSignals([
    {
      key: "seller_rating",
      label: "별점",
      value: normalizeInlineText(rating ?? ""),
    },
    {
      key: "satisfaction_count",
      label: "만족후기",
      value: normalizeInlineText(satisfactionCount ?? ""),
    },
    {
      key: "review_count",
      label: "후기",
      value: normalizeInlineText(reviewCount ?? ""),
    },
    {
      key: "transaction_count",
      label: "거래내역",
      value: normalizeInlineText(transactionCount ?? ""),
    },
  ]);
}

export function isBunjangChatHtml(html: string, pageUrl: string): boolean {
  return (
    /data-safe-ticket-chat|data-chat-message|data-page-kind="trade-chat"/i.test(html) ||
    BUNJANG_CHAT_URL_PATTERN.test(pageUrl)
  );
}

export function parseBunjangProductHtml(html: string, pageUrl: string): ScanCreateRequest {
  const productJsonLd = extractProductJsonLd(html);
  const pageTitle =
    extractBunjangTitle(html) ||
    (productJsonLd?.name ? normalizeInlineText(productJsonLd.name) : "");
  const priceText = extractBunjangPriceText(html);
  const description = extractBunjangDescription(html);
  const sellerNickname = extractBunjangSellerNickname(html);
  const sellerId = extractBunjangSellerId(html, sellerNickname);
  const marketplaceSignals = extractBunjangMarketplaceSignals(html);
  const price =
    parseMoney(priceText) ||
    (productJsonLd?.offers?.price !== undefined ? parseMoney(String(productJsonLd.offers.price)) : 0);

  return {
    platform: "bunjang",
    page_url: pageUrl,
    page_title: pageTitle,
    price,
    seller: {
      seller_id: sellerId,
      nickname: sellerNickname,
    },
    content_blocks: [
      {
        block_id: "title",
        text: pageTitle,
      },
      {
        block_id: "body-1",
        text: description,
      },
    ].filter((block) => block.text.trim().length > 0),
    marketplace_signals: marketplaceSignals,
  };
}

export function parseBunjangChatHtml(html: string, pageUrl: string): ScanCreateRequest {
  const pageTitleRaw =
    fallbackMatch(html, /data-product-title[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /<title>([^<]+?)\s*\|\s*[^<]+<\/title>/) ??
    matchOrThrow(html, /<title>([^<]+)<\/title>/, "Bunjang chat title");
  const priceTextRaw =
    fallbackMatch(html, /data-product-price[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /<b[^>]*>([\d,\s]+)<\/b>/) ??
    "0";
  const sellerNicknameRaw =
    fallbackMatch(html, /data-seller-name[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>\s*<p>/) ??
    "unknown";
  const sellerId =
    fallbackMatch(html, /data-seller-id="([^"]+)"/) ??
    buildFallbackSellerId("bunjang-chat-seller", normalizeInlineText(decodeFieldText(sellerNicknameRaw)));
  const chatBlocks = extractChatBlocks(html, "bg-chat");
  const pageTitle = normalizeInlineText(decodeFieldText(pageTitleRaw));
  const priceText = normalizeInlineText(decodeFieldText(priceTextRaw));
  const sellerNickname = normalizeInlineText(decodeFieldText(sellerNicknameRaw));
  const marketplaceSignals = extractBunjangMarketplaceSignals(html);

  return {
    platform: "bunjang",
    page_url: pageUrl,
    page_title: pageTitle,
    price: parseMoney(priceText),
    seller: {
      seller_id: sellerId,
      nickname: sellerNickname,
    },
    content_blocks: chatBlocks.filter((block) => block.text.trim().length > 0),
    marketplace_signals: marketplaceSignals,
  };
}

export function parseBunjangPageHtml(html: string, pageUrl: string): ScanCreateRequest {
  return isBunjangChatHtml(html, pageUrl)
    ? parseBunjangChatHtml(html, pageUrl)
    : parseBunjangProductHtml(html, pageUrl);
}
