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

function extractVisibleProductSection(html: string): string {
  return (
    fallbackMatch(html, /(<div[^>]+_container_[^"]*[\s\S]*?_shopProfileSection_[\s\S]*?<\/div>\s*<\/div>)/) ??
    html
  );
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
    fallbackMatch(html, /<span[^>]*Typography_typography_variant_T2[^"]*"[^>]*>([\d,]+)원?<\/span>/) ??
    fallbackMatch(html, /<span[^>]*Typography_typography_variant_S1[^"]*"[^>]*>([\d,]+)원?<\/span>/) ??
    fallbackMatch(html, />([\d,]{2,})원?<\/span>/) ??
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
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>\s*<p>★/) ??
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>/);

  return raw ? normalizeInlineText(decodeFieldText(raw)) : "unknown";
}

function extractBunjangSellerId(html: string, sellerNickname: string): string {
  const explicitId =
    fallbackMatch(html, /\/shops\/(\d+)/) ??
    html.match(/"(?:shopId|storeId|sellerId|memberId|userId)"\s*:\s*"?(\\?\d{4,})"?/i)?.[1]?.replace(/\\/g, "");

  return explicitId ?? buildFallbackSellerId("bunjang-seller", sellerNickname);
}

function extractShippingText(html: string): string {
  const visibleSection = extractVisibleProductSection(html);
  const raw =
    fallbackMatch(visibleSection, /배송비[\s\S]{0,120}?>([^<]*?)<\/span>/) ??
    fallbackMatch(visibleSection, /배송비[\s\S]{0,120}?([가-힣A-Za-z0-9 ,]+)구매하기/);

  return raw ? normalizeInlineText(decodeFieldText(raw)) : "";
}

function extractBunjangMarketplaceSignals(html: string) {
  const rating =
    html.match(/★\s*([0-9.]+)/)?.[1] ??
    html.match(/(?:별점|평점)\s*([0-9.]+)/)?.[1];
  const satisfactionCount = html.match(/만족후기\s*([0-9,]+)/)?.[1];
  const reviewCount = html.match(/후기\s*([0-9,]+)/)?.[1];
  const transactionCount =
    html.match(/거래(?:내역|횟수)\s*([0-9,]+)/)?.[1] ??
    html.match(/지금까지\s*([0-9,]+)개의 상품을 판매했어요/)?.[1];

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
  const shipping = extractShippingText(html);
  const sellerNickname = extractBunjangSellerNickname(html);
  const sellerId = extractBunjangSellerId(html, sellerNickname);
  const marketplaceSignals = extractBunjangMarketplaceSignals(html);
  const marketplaceSignalsBlock = buildMarketplaceSignalsBlock(marketplaceSignals);
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
        text: [description, shipping].filter(Boolean).join("\n"),
      },
      ...(marketplaceSignalsBlock ? [marketplaceSignalsBlock] : []),
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
  const tradeLocationRaw = fallbackMatch(html, /data-trade-location[^>]*>([\s\S]*?)<\/[^>]+>/) ?? "";
  const sellerNicknameRaw =
    fallbackMatch(html, /data-seller-name[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>\s*<p>★/) ??
    "unknown";
  const sellerId =
    fallbackMatch(html, /data-seller-id="([^"]+)"/) ??
    buildFallbackSellerId("bunjang-chat-seller", normalizeInlineText(decodeFieldText(sellerNicknameRaw)));
  const chatBlocks = extractChatBlocks(html, "bg-chat");
  const pageTitle = normalizeInlineText(decodeFieldText(pageTitleRaw));
  const priceText = normalizeInlineText(decodeFieldText(priceTextRaw));
  const tradeLocation = normalizeInlineText(decodeFieldText(tradeLocationRaw));
  const sellerNickname = normalizeInlineText(decodeFieldText(sellerNicknameRaw));
  const marketplaceSignals = extractBunjangMarketplaceSignals(html);
  const marketplaceSignalsBlock = buildMarketplaceSignalsBlock(marketplaceSignals);

  return {
    platform: "bunjang",
    page_url: pageUrl,
    page_title: pageTitle,
    price: parseMoney(priceText),
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
        block_id: "product-summary",
        text: [pageTitle, priceText, tradeLocation].filter(Boolean).join(" "),
      },
      ...(marketplaceSignalsBlock ? [marketplaceSignalsBlock] : []),
      ...chatBlocks,
    ].filter((block) => block.text.trim().length > 0),
    marketplace_signals: marketplaceSignals,
  };
}

export function parseBunjangPageHtml(html: string, pageUrl: string): ScanCreateRequest {
  return isBunjangChatHtml(html, pageUrl)
    ? parseBunjangChatHtml(html, pageUrl)
    : parseBunjangProductHtml(html, pageUrl);
}
