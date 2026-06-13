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
  toAbsoluteUrl,
} from "./parser-utils";

const BUNJANG_CHAT_URL_PATTERN = /\/(?:talk|chat|message)(?:[/?#]|$)|[?&](room|chat)/i;

function isGenericBunjangTitle(title: string | undefined): boolean {
  if (!title) {
    return true;
  }

  const normalized = normalizeInlineText(title);
  return !normalized || normalized === "번개장터";
}

function isGenericBunjangSellerName(value: string | undefined): boolean {
  const normalized = normalizeInlineText(value ?? "");
  return !normalized || normalized === "unknown" || normalized === "번개장터";
}

function isFallbackBunjangSellerId(value: string | undefined): boolean {
  return !value || /^bunjang-(?:chat-)?seller-/i.test(value);
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
    extractBunjangTypographySellerName(html) ??
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>\s*<p>/) ??
    fallbackMatch(html, /<strong[^>]*>([^<]+)<\/strong>/);

  return raw ? normalizeInlineText(decodeFieldText(raw)) : "unknown";
}

function extractBunjangTypographySellerName(html: string): string | undefined {
  for (const match of html.matchAll(/<span([^>]*)>([\s\S]*?)<\/span>/gi)) {
    const attributes = match[1] ?? "";
    if (!/Typography_typography_variant_T4/i.test(attributes) || /_productName_|productName/i.test(attributes)) {
      continue;
    }

    const value = normalizeInlineText(decodeFieldText(match[2] ?? ""));
    if (isUsableBunjangSellerName(value)) {
      return value;
    }
  }

  return undefined;
}

function isUsableBunjangSellerName(value: string): boolean {
  return Boolean(value) && value.length <= 32 && !/[0-9,]+\s*원/.test(value) && !["번개장터", "상점정보"].includes(value);
}

function extractBunjangSellerId(html: string, sellerNickname: string): string {
  const explicitId =
    fallbackMatch(html, /data-seller-id="([^"]+)"/) ??
    fallbackMatch(html, /\/shops\/(\d+)/) ??
    html.match(/"(?:shopId|storeId|sellerId|memberId|userId)"\s*:\s*"?(\\?\d{4,})"?/i)?.[1]?.replace(/\\/g, "");

  return explicitId ?? buildFallbackSellerId("bunjang-seller", sellerNickname);
}

function extractBunjangSellerHref(html: string): string | undefined {
  return (
    fallbackMatch(html, /href="([^"]*\/shops\/\d+[^"]*)"/) ??
    fallbackMatch(html, /href="([^"]*\/shop\/\d+[^"]*)"/)
  );
}

function buildBunjangSellerProfileUrl(sellerId: string | undefined, href: string | undefined, pageUrl: string): string | undefined {
  const absoluteHref = toAbsoluteUrl(href, pageUrl);
  if (absoluteHref && /^https:\/\/(?:m\.|www\.)?bunjang\.co\.kr\/shops?\/\d+/i.test(absoluteHref)) {
    return absoluteHref;
  }

  const idFromHref = fallbackMatch(absoluteHref ?? href ?? "", /\/shops?\/(\d+)/i);
  const idFromSellerId = sellerId?.match(/(?:shop|store|seller|user|bunjang-user)[^\d]*(\d{3,})/i)?.[1] ?? sellerId?.match(/^(\d{3,})$/)?.[1];
  const profileSellerId = idFromSellerId ?? idFromHref;
  if (profileSellerId) {
    return `https://m.bunjang.co.kr/shops/${profileSellerId}`;
  }

  return undefined;
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

function firstVisibleText(document: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = normalizeInlineText(document.querySelector<HTMLElement>(selector)?.textContent ?? "");
    if (value) {
      return value;
    }
  }
  return "";
}

function extractBunjangLivePrice(document: Document): number {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "span[class*='Typography_typography_variant_T2']",
        "span[class*='Typography_typography_variant_S1']",
        "strong",
        "b",
      ].join(", "),
    ),
  )
    .map((element) => normalizeInlineText(element.textContent ?? ""))
    .filter((value) => /^[\d,]+\s*원$/.test(value))
    .map(parseMoney)
    .filter((value) => value > 0);

  return candidates.length ? Math.max(...candidates) : 0;
}

function extractBunjangLiveSellerName(document: Document, titleText: string): string {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "span[class*='Typography_typography_variant_T4']",
        "strong",
      ].join(", "),
    ),
  );

  for (const element of candidates) {
    const className = element.getAttribute("class") ?? "";
    if (/_productName_|productName/i.test(className)) {
      continue;
    }

    const value = normalizeInlineText(element.textContent ?? "");
    if (value === titleText) {
      continue;
    }
    if (isUsableBunjangSellerName(value)) {
      return value;
    }
  }

  return "";
}

function extractBunjangLiveSellerHref(document: Document): string | undefined {
  const anchor = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/shops/"], a[href*="/shop/"]'),
  ).find((candidate) => /\/shops?\/\d+/i.test(candidate.getAttribute("href") ?? ""));

  return anchor?.getAttribute("href") ?? undefined;
}

function extractBunjangLiveSellerIdFromResources(document: Document): string | undefined {
  const performanceApi = document.defaultView?.performance ?? globalThis.performance;
  const entries = performanceApi?.getEntriesByType?.("resource") ?? [];

  for (const entry of entries) {
    const resourceUrl = "name" in entry ? entry.name : "";
    const sellerId =
      fallbackMatch(resourceUrl, /\/api\/review\/v\d+\/users\/(\d+)\/reviews-statistics/i) ??
      fallbackMatch(resourceUrl, /\/api\/review\/v\d+\/users\/(\d+)\/reviews/i) ??
      fallbackMatch(resourceUrl, /\/shops?\/(\d+)/i);

    if (sellerId) {
      return sellerId;
    }
  }

  return undefined;
}

function mergeMarketplaceSignals(
  currentSignals: ScanCreateRequest["marketplace_signals"],
  nextSignals: ScanCreateRequest["marketplace_signals"],
): ScanCreateRequest["marketplace_signals"] {
  const merged = [...currentSignals];
  for (const signal of nextSignals) {
    const index = merged.findIndex((current) => current.key === signal.key);
    if (index >= 0) {
      merged[index] = signal;
    } else {
      merged.push(signal);
    }
  }
  return merged;
}

function syncContentBlock(payload: ScanCreateRequest, blockId: string, text: string): void {
  const normalized = normalizeInlineText(text);
  if (!normalized) {
    return;
  }

  const existingBlock = payload.content_blocks.find((block) => block.block_id === blockId);
  if (existingBlock) {
    existingBlock.text = normalized;
    return;
  }

  payload.content_blocks.unshift({ block_id: blockId, text: normalized });
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
  const sellerHref = extractBunjangSellerHref(html);
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
      profile_url: buildBunjangSellerProfileUrl(sellerId, sellerHref, pageUrl),
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

export function enhanceBunjangProductPayloadFromDocument(
  document: Document,
  payload: ScanCreateRequest,
): ScanCreateRequest {
  if (payload.platform !== "bunjang") {
    return payload;
  }

  const nextPayload: ScanCreateRequest = {
    ...payload,
    seller: { ...payload.seller },
    content_blocks: payload.content_blocks.map((block) => ({ ...block })),
    marketplace_signals: payload.marketplace_signals.map((signal) => ({ ...signal })),
  };
  const titleText = firstVisibleText(document, [
    "[class*='_productName_']",
    "[class*='productName']",
    "[data-testid*='product-name']",
    "h1",
  ]);
  const price = extractBunjangLivePrice(document);
  const sellerHref = extractBunjangLiveSellerHref(document);
  const sellerId =
    fallbackMatch(sellerHref ?? "", /\/shops?\/(\d+)/i) ?? extractBunjangLiveSellerIdFromResources(document);
  const sellerNickname = extractBunjangLiveSellerName(document, titleText);
  const description = normalizeInlineText(
    document.querySelector<HTMLElement>("[class*='_description_'], [data-testid*='description']")?.textContent ?? "",
  );
  const visibleSignals = extractBunjangMarketplaceSignals(document.body?.innerText ?? "");

  if (titleText && isGenericBunjangTitle(nextPayload.page_title)) {
    nextPayload.page_title = titleText;
    syncContentBlock(nextPayload, "title", titleText);
  }

  if (price > 0 && nextPayload.price <= 0) {
    nextPayload.price = price;
  }

  if (
    sellerId &&
    (!nextPayload.seller.seller_id.trim() ||
      nextPayload.seller.seller_id.includes("unknown") ||
      isFallbackBunjangSellerId(nextPayload.seller.seller_id))
  ) {
    nextPayload.seller.seller_id = sellerId;
  }

  if (sellerNickname && isGenericBunjangSellerName(nextPayload.seller.nickname)) {
    nextPayload.seller.nickname = sellerNickname;
  }

  const profileUrl = buildBunjangSellerProfileUrl(nextPayload.seller.seller_id, sellerHref, nextPayload.page_url);
  if (profileUrl) {
    nextPayload.seller.profile_url = profileUrl;
  }

  if (description) {
    syncContentBlock(nextPayload, "body-1", description);
  }

  if (visibleSignals.length) {
    nextPayload.marketplace_signals = mergeMarketplaceSignals(nextPayload.marketplace_signals, visibleSignals);
  }

  return nextPayload;
}

export function isReliableBunjangProductPayload(payload: ScanCreateRequest): boolean {
  return (
    payload.platform !== "bunjang" ||
    (!payload.page_url.includes("/products/") ||
      (payload.price > 0 &&
        !isGenericBunjangTitle(payload.page_title) &&
        !isGenericBunjangSellerName(payload.seller.nickname)))
  );
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
  const sellerHref = fallbackMatch(html, /data-seller-profile-url="([^"]+)"/) ?? extractBunjangSellerHref(html);
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
      profile_url: buildBunjangSellerProfileUrl(sellerId, sellerHref, pageUrl),
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
