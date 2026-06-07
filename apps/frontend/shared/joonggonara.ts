import type { ContentBlock, MarketplaceSignal, ScanCreateRequest } from "./types";
import {
  buildFallbackSellerId,
  cleanMultiline,
  decodeFieldText,
  extractChatBlocks,
  extractChatBlocksFromDocument,
  extractProductJsonLd,
  fallbackMatch,
  matchOrThrow,
  normalizeInlineText,
  normalizeMarketplaceSignals,
  parseMoney,
  toAbsoluteUrl,
} from "./parser-utils";

const JOONGNA_SUSPICIOUS_SELLER_TOKENS = [
  "결제 혜택",
  "가게 정보",
  "최근 본 상품",
  "파워쇼핑",
  "파워링크",
  "앱 다운로드",
  "카테고리",
  "판매하기",
  "채팅하기",
  "마이",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractJoongnaString(source: string, fieldName: string): string | undefined {
  const escapedPattern = new RegExp(String.raw`\\"${fieldName}\\":\\"([\s\S]*?)\\"`);
  const rawPattern = new RegExp(`"${fieldName}":"([\\s\\S]*?)"`);

  return fallbackMatch(source, escapedPattern) ?? fallbackMatch(source, rawPattern);
}

function extractJoongnaNumber(source: string, fieldName: string): string | undefined {
  const escapedPattern = new RegExp(String.raw`\\"${fieldName}\\":(\\d+)`);
  const rawPattern = new RegExp(`"${fieldName}":(\\d+)`);

  return fallbackMatch(source, escapedPattern) ?? fallbackMatch(source, rawPattern);
}

function extractJoongnaVisiblePrice(html: string): string | undefined {
  const won = "원";
  const titleHintRaw =
    fallbackMatch(html, /<title>([^<]+?) \| [^<]+<\/title>/) ??
    fallbackMatch(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  const titleHint = titleHintRaw ? escapeRegExp(decodeFieldText(titleHintRaw)) : null;

  if (titleHint) {
    const titleAnchoredPrice =
      fallbackMatch(
        html,
        new RegExp(
          `${titleHint}[\\s\\S]{0,1600}?<span[^>]*text-32 font-bold[^"]*"[^>]*>([\\d,]+)${won}<\\/span>`,
        ),
      ) ??
      fallbackMatch(
        html,
        new RegExp(
          `${titleHint}[\\s\\S]{0,1600}?<span[^>]*text-24 font-bold[^"]*"[^>]*>([\\d,]+)${won}<\\/span>`,
        ),
      );

    if (titleAnchoredPrice) {
      return titleAnchoredPrice;
    }
  }

  return (
    fallbackMatch(
      html,
      new RegExp(
        `<h1[^>]*>[\\s\\S]*?<\\/h1>[\\s\\S]{0,1200}?<span[^>]*text-32 font-bold[^"]*"[^>]*>([\\d,]+)${won}<\\/span>`,
      ),
    ) ??
    fallbackMatch(
      html,
      new RegExp(
        `<h1[^>]*>[\\s\\S]*?<\\/h1>[\\s\\S]{0,1200}?<span[^>]*text-24 font-bold[^"]*"[^>]*>([\\d,]+)${won}<\\/span>`,
      ),
    )
  );
}

function extractJoongnaVisibleSeller(html: string): string | undefined {
  return (
    fallbackMatch(
      html,
      /<a[^>]+href="\/store\/\d+"[\s\S]{0,1200}?<span[^>]*text-gray-900[^"]*"[^>]*>([^<]+)<\/span>/,
    ) ??
    fallbackMatch(
      html,
      /가게 정보[\s\S]{0,1200}?<span[^>]*text-gray-900[^"]*"[^>]*>([^<]+)<\/span>/,
    )
  );
}

function extractJoongnaSellerFromWatermark(source: string): string | undefined {
  const rawValue =
    fallbackMatch(source, /(?:\?|&|&amp;)ftext=([^"&]+)/i) ??
    fallbackMatch(source, /"waterMarkUrl":"[^"]*(?:\?|&|&amp;)ftext=([^"&]+)/i);

  if (!rawValue) {
    return undefined;
  }

  try {
    return normalizeInlineText(decodeURIComponent(rawValue.replace(/&amp;/g, "&")));
  } catch {
    return undefined;
  }
}

function buildJoongnaSellerProfileUrl(sellerId: string | undefined, href: string | undefined, pageUrl: string): string | undefined {
  const absoluteHref = toAbsoluteUrl(href, pageUrl);
  if (absoluteHref && /^https:\/\/(?:web\.)?joongna\.com\/store\/\d+/i.test(absoluteHref)) {
    return absoluteHref;
  }

  const idFromHref = fallbackMatch(absoluteHref ?? href ?? "", /\/store\/(\d+)/i);
  const profileSellerId = sellerId && /^\d+$/.test(sellerId) ? sellerId : idFromHref;
  if (profileSellerId) {
    return `https://web.joongna.com/store/${profileSellerId}`;
  }

  return undefined;
}

function extractJoongnaMarketplaceSignals(html: string): MarketplaceSignal[] {
  const isDecorativeSignal = (value: string | undefined): boolean => {
    if (!value) {
      return true;
    }

    const normalizedValue = normalizeInlineText(value);
    return /^[^\p{L}\p{N}]+$/u.test(normalizedValue);
  };

  const extractMetric = (labelEscaped: string, ariaPattern?: RegExp): string | undefined => {
    if (ariaPattern) {
      const ariaValue = fallbackMatch(html, ariaPattern);
      if (ariaValue && !isDecorativeSignal(ariaValue)) {
        return ariaValue;
      }
    }

    const rawValue =
      fallbackMatch(
        html,
        new RegExp(`${labelEscaped}[\\s\\S]{0,160}?<span[^>]*>([^<]+)<\\/span>`),
      ) ??
      fallbackMatch(
        html,
        new RegExp(`${labelEscaped}[\\s\\S]{0,160}?<div[^>]*>([^<]+)<\\/div>`),
      ) ??
      fallbackMatch(
        html,
        new RegExp(`${labelEscaped}[\\s\\S]{0,80}?>([\\d,]+|가능|불가)<`),
      );

    return isDecorativeSignal(rawValue) ? undefined : rawValue;
  };

  const trustScore =
    extractMetric("신뢰지수", /신뢰지수[\s\S]{0,120}?aria-label="([^"]+)"/) ??
    fallbackMatch(html, /신뢰지수[\s\S]{0,120}?>([\d,]+)</);
  const safePaymentCount = extractMetric("안심결제");
  const reviewCount = extractMetric("거래후기");
  const favoriteCount = extractMetric("단골");

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

function extractSignalsFromVisibleText(text: string, platform: ScanCreateRequest["platform"]): MarketplaceSignal[] {
  const normalizedText = normalizeInlineText(text);

  if (!normalizedText) {
    return [];
  }

  const pick = (pattern: RegExp) => normalizedText.match(pattern)?.[1]?.trim() ?? "";

  if (platform === "joonggonara") {
    return normalizeMarketplaceSignals([
      { key: "trust_score", label: "신뢰지수", value: pick(/신뢰지수\s*([0-9,.]+)/) },
      { key: "safe_payment_count", label: "안심결제", value: pick(/안심결제\s*([0-9,]+)/) },
      { key: "review_count", label: "거래후기", value: pick(/거래후기\s*([0-9,]+)/) },
      { key: "favorite_count", label: "단골", value: pick(/단골\s*([0-9,]+)/) },
    ]);
  }

  return normalizeMarketplaceSignals([
    {
      key: "seller_rating",
      label: "별점",
      value:
        pick(/(?:별점|평점)\s*([0-9.]+)/) ||
        pick(/[⭐★☆]\s*([0-9.]+)/) ||
        pick(/([0-9.]+)\s*[⭐★☆]+/) ||
        pick(/([0-9.]+)\s*점\s*[⭐★☆]+/),
    },
    {
      key: "satisfaction_count",
      label: "만족후기",
      value: pick(/만족후기\s*([0-9,]+)/) || pick(/([0-9]{1,3}%?)\s*만족후기/),
    },
    {
      key: "review_count",
      label: "후기",
      value: pick(/(?:전체\s*)?후기\s*([0-9,]+)/),
    },
    {
      key: "transaction_count",
      label: "거래내역",
      value:
        pick(/거래(?:내역|횟수)\s*([0-9,]+)/) ||
        pick(/지금까지\s*([0-9,]+)개의 상품을 판매했어요/),
    },
  ]);
}

function mergeMarketplaceSignals(currentSignals: MarketplaceSignal[], nextSignals: MarketplaceSignal[]): MarketplaceSignal[] {
  const nextSignalMap = new Map(nextSignals.map((signal) => [signal.key, signal]));
  const mergedSignals = currentSignals
    .filter((signal) => !nextSignalMap.has(signal.key))
    .concat(nextSignals);

  return normalizeMarketplaceSignals(mergedSignals);
}

function isSuspiciousJoongnaSeller(value: string): boolean {
  const normalizedValue = normalizeInlineText(value);

  if (!normalizedValue || normalizedValue === "unknown") {
    return true;
  }

  return JOONGNA_SUSPICIOUS_SELLER_TOKENS.some((token) => normalizedValue.includes(token));
}

function isChatPayload(payload: ScanCreateRequest): boolean {
  return /\/(?:chat|message|messages|talk)(?:[/?#]|$)|[?&](room|chat)/i.test(payload.page_url);
}

function isChatBlockId(blockId: string): boolean {
  return /^jn-chat-\d+$/i.test(blockId) || /^bg-chat-\d+$/i.test(blockId);
}

function syncChatBlocks(payload: ScanCreateRequest, chatBlocks: ContentBlock[]): void {
  if (!chatBlocks.length) {
    return;
  }

  if (isChatPayload(payload)) {
    payload.content_blocks = [...chatBlocks];
    return;
  }

  const staticBlocks = payload.content_blocks.filter((block) => !isChatBlockId(block.block_id));
  payload.content_blocks = [...staticBlocks, ...chatBlocks];
}

export function isJoongnaChatHtml(html: string, pageUrl: string): boolean {
  return (
    /data-chat-message|data-safe-ticket-chat|jn-chat-drawer/i.test(html) ||
    /\/chat(?:[/?#]|$)|\/messages?(?:[/?#]|$)|[?&](room|chat)/i.test(pageUrl)
  );
}

export function parseJoongnaProductHtml(html: string, pageUrl: string): ScanCreateRequest {
  const productJsonLd = extractProductJsonLd(html);
  const marketplaceSignals = extractJoongnaMarketplaceSignals(html);

  const titleRaw =
    extractJoongnaString(html, "productTitle") ??
    productJsonLd?.name ??
    fallbackMatch(html, /<title>([^<]+?) \| [^<]+<\/title>/);
  const sellerId =
    extractJoongnaNumber(html, "storeSeq") ??
    fallbackMatch(html, /href="\/store\/(\d+)"/) ??
    buildFallbackSellerId("joongna-seller", "unknown");
  const sellerHref = fallbackMatch(html, /href="([^"]*\/store\/\d+[^"]*)"/);
  const sellerNicknameRaw =
    extractJoongnaString(html, "nickName") ??
    productJsonLd?.offers?.seller?.name ??
    extractJoongnaSellerFromWatermark(html) ??
    extractJoongnaVisibleSeller(html);
  const priceRaw =
    extractJoongnaNumber(html, "productPrice") ??
    (productJsonLd?.offers?.price !== undefined ? String(productJsonLd.offers.price) : undefined) ??
    extractJoongnaVisiblePrice(html);
  const descriptionRaw =
    extractJoongnaString(html, "productDescription") ??
    productJsonLd?.description ??
    fallbackMatch(html, /<p[^>]*whitespace-pre-line[^>]*>([\s\S]*?)<\/p>/);

  const title = titleRaw
    ? cleanMultiline(decodeFieldText(titleRaw))
    : matchOrThrow(html, /<title>([^<]+)<\/title>/, "Joongna title");
  const sellerNickname = sellerNicknameRaw ? normalizeInlineText(decodeFieldText(sellerNicknameRaw)) : "unknown";
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
      profile_url: buildJoongnaSellerProfileUrl(sellerId, sellerHref, pageUrl),
    },
    content_blocks: [
      { block_id: "title", text: title },
      { block_id: "body-1", text: description },
    ].filter((block) => block.text.trim().length > 0),
    marketplace_signals: marketplaceSignals,
  };
}

export function enhanceJoongnaProductPayloadFromDocument(
  document: Document,
  payload: ScanCreateRequest,
): ScanCreateRequest {
  const titleText = normalizeInlineText(document.querySelector("h1")?.textContent ?? "");
  const priceCandidates = Array.from(
    document.querySelectorAll(
      "span.text-32.font-bold, span.text-24.font-bold, span[class*='text-32'][class*='font-bold'], span[class*='text-24'][class*='font-bold']",
    ),
  )
    .map((element) => normalizeInlineText(element.textContent ?? ""))
    .filter((value) => /\d[\d,]*\s*원/.test(value));
  const sellerAnchor = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/store/"]')).find((anchor) => {
    const nickname = normalizeInlineText(
      anchor.querySelector("span.text-gray-900, span[class*='text-gray-900']")?.textContent ?? "",
    );
    return !isSuspiciousJoongnaSeller(nickname);
  });
  const sellerNickname = normalizeInlineText(
    sellerAnchor?.querySelector("span.text-gray-900, span[class*='text-gray-900']")?.textContent ?? "",
  );
  const sellerId = fallbackMatch(sellerAnchor?.getAttribute("href") ?? "", /\/store\/(\d+)/);
  const watermarkSeller = extractJoongnaSellerFromWatermark(document.documentElement?.outerHTML ?? "");

  const nextPayload: ScanCreateRequest = {
    ...payload,
    seller: {
      ...payload.seller,
    },
    content_blocks: payload.content_blocks.map((block) => ({ ...block })),
    marketplace_signals: payload.marketplace_signals.map((signal) => ({ ...signal })),
  };
  const sellerProfileUrl = buildJoongnaSellerProfileUrl(
    sellerId ?? nextPayload.seller.seller_id,
    sellerAnchor?.getAttribute("href") ?? nextPayload.seller.profile_url ?? undefined,
    nextPayload.page_url,
  );
  const bunjangSellerAnchor = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/shops/"], a[href*="/shop/"]'),
  ).find((anchor) => /\/shops?\/\d+/i.test(anchor.getAttribute("href") ?? ""));
  const bunjangSellerProfileUrl = toAbsoluteUrl(
    bunjangSellerAnchor?.getAttribute("href") ?? nextPayload.seller.profile_url ?? undefined,
    nextPayload.page_url,
  );

  if (payload.platform === "joonggonara" && titleText.length > 3 && titleText !== payload.page_title) {
    nextPayload.page_title = titleText;
    const titleBlock = nextPayload.content_blocks.find((block) => block.block_id === "title");
    if (titleBlock) {
      titleBlock.text = titleText;
    }
  }

  if (payload.platform === "joonggonara" && priceCandidates.length) {
    const price = parseMoney(priceCandidates[0]);
    if (price > 0) {
      nextPayload.price = price;
    }
  }

  const shouldReplaceSeller =
    payload.platform === "joonggonara" &&
    (!nextPayload.seller.seller_id.trim() ||
      nextPayload.seller.seller_id.includes("unknown") ||
      isSuspiciousJoongnaSeller(nextPayload.seller.nickname));

  if (shouldReplaceSeller) {
    if (sellerId) {
      nextPayload.seller.seller_id = sellerId;
    }

    if (sellerNickname && !isSuspiciousJoongnaSeller(sellerNickname)) {
      nextPayload.seller.nickname = sellerNickname;
    } else if (watermarkSeller && !isSuspiciousJoongnaSeller(watermarkSeller)) {
      nextPayload.seller.nickname = watermarkSeller;
    }
  }

  if (payload.platform === "joonggonara" && sellerProfileUrl) {
    nextPayload.seller.profile_url = sellerProfileUrl;
  }

  if (payload.platform === "bunjang" && bunjangSellerProfileUrl) {
    nextPayload.seller.profile_url = bunjangSellerProfileUrl;
  }

  const visibleSignals = extractSignalsFromVisibleText(document.body?.innerText ?? "", payload.platform);
  if (visibleSignals.length) {
    nextPayload.marketplace_signals = mergeMarketplaceSignals(nextPayload.marketplace_signals, visibleSignals);
  }

  if (isChatPayload(nextPayload)) {
    const liveChatBlocks = extractChatBlocksFromDocument(
      document,
      nextPayload.platform === "joonggonara" ? "jn-chat" : "bg-chat",
    );
    if (liveChatBlocks.length) {
      syncChatBlocks(nextPayload, liveChatBlocks);
    }
  }

  return nextPayload;
}

export function isReliableJoongnaProductPayload(payload: ScanCreateRequest): boolean {
  return (
    payload.platform !== "joonggonara" ||
    (!payload.page_url.includes("/product/") ||
      (payload.price > 0 &&
        payload.seller.seller_id.trim().length > 0 &&
        !payload.seller.seller_id.includes("unknown") &&
        !isSuspiciousJoongnaSeller(payload.seller.nickname)))
  );
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
  const sellerNameRaw =
    fallbackMatch(html, /data-seller-name[^>]*>([\s\S]*?)<\/[^>]+>/) ??
    fallbackMatch(html, /jn-chat-title[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/) ??
    "unknown";
  const sellerId =
    fallbackMatch(html, /data-seller-id="([^"]+)"/) ??
    buildFallbackSellerId("joongna-chat-seller", normalizeInlineText(decodeFieldText(sellerNameRaw)));
  const sellerHref = fallbackMatch(html, /data-seller-profile-url="([^"]+)"/) ?? fallbackMatch(html, /href="([^"]*\/store\/\d+[^"]*)"/);
  const chatBlocks = extractChatBlocks(html, "jn-chat");

  const title = normalizeInlineText(decodeFieldText(titleRaw));
  const priceText = normalizeInlineText(decodeFieldText(priceTextRaw));
  const sellerNickname = normalizeInlineText(decodeFieldText(sellerNameRaw));
  const marketplaceSignals = extractJoongnaMarketplaceSignals(html);

  return {
    platform: "joonggonara",
    page_url: pageUrl,
    page_title: title,
    price: parseMoney(priceText),
    seller: {
      seller_id: sellerId,
      nickname: sellerNickname,
      profile_url: buildJoongnaSellerProfileUrl(sellerId, sellerHref, pageUrl),
    },
    content_blocks: chatBlocks.filter((block) => block.text.trim().length > 0),
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
