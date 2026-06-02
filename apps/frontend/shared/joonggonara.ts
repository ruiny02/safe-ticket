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

const JOONGNA_SUSPICIOUS_SELLER_TOKENS = [
  "\uacb0\uc81c \ud61c\ud0dd",
  "\uac00\uac8c \uc815\ubcf4",
  "\ucd5c\uadfc \ubcf8 \uc0c1\ud488",
  "\ud30c\uc6cc\uc1fc\ud551",
  "\ud30c\uc6cc\ub9c1\ud06c",
  "\uc571 \ub2e4\uc6b4\ub85c\ub4dc",
  "\uce74\ud14c\uace0\ub9ac",
  "\ud310\ub9e4\ud558\uae30",
  "\ucc44\ud305\ud558\uae30",
  "\ub9c8\uc774",
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
  const escapedPattern = new RegExp(String.raw`\\"${fieldName}\\":(\d+)`);
  const rawPattern = new RegExp(`"${fieldName}":(\\d+)`);

  return fallbackMatch(source, escapedPattern) ?? fallbackMatch(source, rawPattern);
}

function extractJoongnaVisiblePrice(html: string): string | undefined {
  const won = "\uc6d0";
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
      new RegExp(`<h1[^>]*>[\\s\\S]*?<\\/h1>[\\s\\S]{0,1200}?<span[^>]*text-32 font-bold[^"]*"[^>]*>([\\d,]+)${won}<\\/span>`),
    ) ??
    fallbackMatch(
      html,
      new RegExp(`<h1[^>]*>[\\s\\S]*?<\\/h1>[\\s\\S]{0,1200}?<span[^>]*text-24 font-bold[^"]*"[^>]*>([\\d,]+)${won}<\\/span>`),
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
      new RegExp(`\\uac00\\uac8c \\uc815\\ubcf4[\\s\\S]{0,1200}?<span[^>]*text-gray-900[^"]*"[^>]*>([^<]+)<\\/span>`),
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

function extractJoongnaMarketplaceSignals(html: string) {
  const trustScore =
    fallbackMatch(
      html,
      new RegExp(`\\uc2e0\\ub8b0\\uc9c0\\uc218<\\/span><span[^>]*aria-label="([^"]+)"`),
    ) ??
    fallbackMatch(html, new RegExp(`\\uc2e0\\ub8b0\\uc9c0\\uc218[\\s\\S]{0,120}?aria-label="([^"]+)"`));
  const safePaymentCount = fallbackMatch(
    html,
    new RegExp(`\\uc548\\uc2ec\\uacb0\\uc81c<\\/span><span[^>]*>([^<]+)<\\/span>`),
  );
  const reviewCount = fallbackMatch(
    html,
    new RegExp(`\\uac70\\ub798\\ud6c4\\uae30<\\/span><span[^>]*>([^<]+)<\\/span>`),
  );
  const favoriteCount = fallbackMatch(
    html,
    new RegExp(`\\ub2e8\\uace8<\\/span><span[^>]*>([^<]+)<\\/span>`),
  );

  return normalizeMarketplaceSignals([
    {
      key: "trust_score",
      label: "\uc2e0\ub8b0\uc9c0\uc218",
      value: normalizeInlineText(trustScore ?? ""),
    },
    {
      key: "safe_payment_count",
      label: "\uc548\uc2ec\uacb0\uc81c",
      value: normalizeInlineText(safePaymentCount ?? ""),
    },
    {
      key: "review_count",
      label: "\uac70\ub798\ud6c4\uae30",
      value: normalizeInlineText(reviewCount ?? ""),
    },
    {
      key: "favorite_count",
      label: "\ub2e8\uace8",
      value: normalizeInlineText(favoriteCount ?? ""),
    },
  ]);
}

function isSuspiciousJoongnaSeller(value: string): boolean {
  const normalizedValue = normalizeInlineText(value);

  if (!normalizedValue || normalizedValue === "unknown") {
    return true;
  }

  return JOONGNA_SUSPICIOUS_SELLER_TOKENS.some((token) => normalizedValue.includes(token));
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
  const marketplaceSignalsBlock = buildMarketplaceSignalsBlock(marketplaceSignals);

  const titleRaw =
    extractJoongnaString(html, "productTitle") ??
    productJsonLd?.name ??
    fallbackMatch(html, /<title>([^<]+?) \| [^<]+<\/title>/);
  const sellerId =
    extractJoongnaNumber(html, "storeSeq") ??
    fallbackMatch(html, /href="\/store\/(\d+)"/) ??
    buildFallbackSellerId("joongna-seller", "unknown");
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

export function enhanceJoongnaProductPayloadFromDocument(
  document: Document,
  payload: ScanCreateRequest,
): ScanCreateRequest {
  if (payload.platform !== "joonggonara") {
    return payload;
  }

  const titleText = normalizeInlineText(document.querySelector("h1")?.textContent ?? "");
  const priceCandidates = Array.from(
    document.querySelectorAll(
      "span.text-32.font-bold, span.text-24.font-bold, span[class*='text-32'][class*='font-bold'], span[class*='text-24'][class*='font-bold']",
    ),
  )
    .map((element) => normalizeInlineText(element.textContent ?? ""))
    .filter((value) => /\d[\d,]*\s*원$/.test(value));
  const sellerAnchor = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/store/"]')).find(
    (anchor) => {
      const nickname = normalizeInlineText(
        anchor.querySelector("span.text-gray-900, span[class*='text-gray-900']")?.textContent ?? "",
      );
      return !isSuspiciousJoongnaSeller(nickname);
    },
  );
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
  };

  if (titleText.length > 3 && titleText !== payload.page_title) {
    nextPayload.page_title = titleText;
    const titleBlock = nextPayload.content_blocks.find((block) => block.block_id === "title");
    if (titleBlock) {
      titleBlock.text = titleText;
    }
  }

  if (priceCandidates.length) {
    const price = parseMoney(priceCandidates[0]);
    if (price > 0) {
      nextPayload.price = price;
    }
  }

  const shouldReplaceSeller =
    !nextPayload.seller.seller_id.trim() ||
    nextPayload.seller.seller_id.includes("unknown") ||
    isSuspiciousJoongnaSeller(nextPayload.seller.nickname);

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
      label: "\uc548\uc2ec\uacb0\uc81c",
      value: new RegExp(`\\uc548\\uc2ec\\uacb0\\uc81c`).test(html) ? "available" : "",
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
