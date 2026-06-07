export interface ProductJsonLd {
  name?: string;
  description?: string;
  offers?: {
    price?: number | string;
    seller?: {
      name?: string;
    };
  };
}

export interface MarketplaceSignal {
  key: string;
  label: string;
  value: string;
}

export function cleanMultiline(value: string): string {
  return value
    .replace(/\\\\r\\\\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function normalizeInlineText(value: string): string {
  return cleanMultiline(value).replace(/\s+/g, " ").trim();
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripMarkup(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function decodeFieldText(value: string): string {
  const decoded = value.includes('\\"')
    ? (JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string)
    : value;
  return cleanMultiline(stripMarkup(decoded));
}

export function parseMoney(value: string | undefined): number {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function fallbackMatch(source: string, pattern: RegExp): string | undefined {
  return source.match(pattern)?.[1];
}

export function matchOrThrow(source: string, pattern: RegExp, fieldName: string): string {
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Failed to extract ${fieldName}`);
  }

  return match[1];
}

export function extractAttr(source: string, name: string): string | null {
  return source.match(new RegExp(`${name}="([^"]+)"`, "i"))?.[1] ?? null;
}

export function readMetaContent(html: string, attrName: "property" | "name", attrValue: string): string | undefined {
  return fallbackMatch(
    html,
    new RegExp(`<meta[^>]+${attrName}="${attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]+content="([^"]+)"`, "i"),
  );
}

export function extractProductJsonLd(html: string): ProductJsonLd | null {
  const scriptMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);

  for (const match of scriptMatches) {
    const rawValue = match[1]?.trim();
    if (!rawValue) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawValue) as ProductJsonLd | ProductJsonLd[];
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const productCandidate = candidates.find((candidate) => typeof candidate?.name === "string");

      if (productCandidate) {
        return productCandidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function buildFallbackSellerId(prefix: string, nickname: string): string {
  const safeNickname = nickname.trim() ? encodeURIComponent(nickname.trim()) : "unknown";
  return `${prefix}-${safeNickname}`;
}

export function toAbsoluteUrl(url: string | undefined | null, baseUrl: string): string | undefined {
  if (!url?.trim()) {
    return undefined;
  }

  try {
    return new URL(decodeHtmlEntities(url.trim()), baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function extractChatBlocks(html: string, prefix = "chat") {
  const matches = html.matchAll(/<([a-z0-9]+)([^>]*data-chat-message[^>]*)>([\s\S]*?)<\/\1>/gi);

  return Array.from(matches)
    .map((match, index) => {
      const attrs = match[2] ?? "";
      const text = normalizeInlineText(stripMarkup(match[3] ?? ""));
      if (!text) {
        return null;
      }

      return {
        block_id: extractAttr(attrs, "data-message-id") ?? `${prefix}-${String(index + 1).padStart(3, "0")}`,
        text,
      };
    })
    .filter((block): block is { block_id: string; text: string } => block !== null);
}

export function extractChatBlocksFromDocument(
  documentRef: Document,
  prefix = "chat",
): Array<{ block_id: string; text: string }> {
  const explicitSelector = [
    "[data-chat-message]",
    "[data-message-id][data-role]",
    "[data-role][data-speaker]",
  ].join(", ");
  const fallbackSelector = [
    "[data-chat-message]",
    "[data-message-id]",
    "[data-testid*='message']",
    "[class*='bubble']",
    "[class*='message']",
    "[class*='msg']",
  ].join(", ");
  const explicitCandidates = Array.from(documentRef.querySelectorAll<HTMLElement>(explicitSelector));
  const selector = explicitCandidates.length ? explicitSelector : fallbackSelector;
  const allCandidates = Array.from(documentRef.querySelectorAll<HTMLElement>(selector));
  const excludedContainerSelector = [
    "#safe-ticket-extension-root",
    "[class*='banner']",
    "[class*='notice']",
    "[class*='guide']",
    "[class*='warning']",
    "[class*='profile']",
    "[class*='protect']",
    "[class*='protection']",
    "[class*='product-strip']",
    "[class*='product-text']",
    "[class*='product-mini']",
    "[class*='pay-card']",
    "[class*='tag']",
    "[class*='empty']",
    "[class*='filter']",
  ].join(", ");
  const excludedTextPatterns = [
    /안심결제 쓰고 사기 걱정 없는 중고거래/,
    /중고나라 채팅,\s*안심결제가 가장 안전합니다/i,
    /외부 거래 유도 및 사기 감지 시스템 작동 중/,
    /앱에서는 채팅 응답이 더 빠르고 편리합니다/i,
    /지금까지\s*\d+개의 상품을 판매했어요/,
    /후기\s*\d+\s*[·•]\s*거래내역\s*\d+/,
    /안심결제란/,
    /앱 다운로드/,
    /사기피해 보상 최대/,
    /^구매하기$/,
  ];
  const candidates = allCandidates.filter((element) => {
    if (!element.isConnected) {
      return false;
    }

    if (element.closest("#safe-ticket-extension-root")) {
      return false;
    }

    if (element.querySelector(selector)) {
      return false;
    }

    const text = normalizeInlineText(element.textContent ?? "");
    if (!text || text.length < 2 || text.length > 280) {
      return false;
    }

    const matchesExplicitSelector =
      typeof element.matches === "function" ? element.matches(explicitSelector) : false;

    if (!matchesExplicitSelector && element.closest(excludedContainerSelector)) {
      return false;
    }

    if (excludedTextPatterns.some((pattern) => pattern.test(text))) {
      return false;
    }

    if (/^(보내기|전송|입력|채팅하기|번개톡|중고나라|번개장터)$/u.test(text)) {
      return false;
    }

    return true;
  });

  const seenTexts = new Set<string>();

  return candidates
    .map((element, index) => {
      const text = normalizeInlineText(element.textContent ?? "");
      if (!text || seenTexts.has(text)) {
        return null;
      }

      seenTexts.add(text);
      return {
        block_id:
          element.dataset.messageId ??
          element.getAttribute("data-message-id") ??
          `${prefix}-${String(index + 1).padStart(3, "0")}`,
        text,
      };
    })
    .filter((block): block is { block_id: string; text: string } => block !== null);
}

export function buildMarketplaceSignalsBlock(
  signals: MarketplaceSignal[],
): { block_id: string; text: string } | null {
  if (!signals.length) {
    return null;
  }

  return {
    block_id: "marketplace-signals",
    text: signals.map((signal) => `${signal.label}: ${signal.value}`).join("\n"),
  };
}

export function normalizeMarketplaceSignals(signals: MarketplaceSignal[]): MarketplaceSignal[] {
  const seen = new Set<string>();

  return signals.filter((signal) => {
    const key = `${signal.key}:${signal.value.trim()}`;
    if (!signal.value.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
