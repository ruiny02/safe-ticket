import type { ScanHighlightTarget, ScanResultResponse } from "../../../shared/types";

export interface PageHighlightTarget {
  blockId: string;
  matchedText: string;
  cssClass: string;
  reasonCode: string;
}

const HIGHLIGHT_SELECTOR = "mark[data-safe-ticket-highlight='true']";
const EXTENSION_ROOT_ID = "safe-ticket-extension-root";

export function extractHighlightTargets(result: ScanResultResponse): PageHighlightTarget[] {
  if (result.status !== "completed" && result.status !== "partial") {
    return [];
  }

  return result.highlight_targets.map((target) => ({
    blockId: target.block_id,
    matchedText: target.matched_text,
    cssClass: target.css_class,
    reasonCode: target.reason_code,
  }));
}

export function applyPageHighlights(
  targets: ScanHighlightTarget[],
  documentRef: Document = document,
): ScanHighlightTarget[] {
  clearPageHighlights(documentRef);

  const appliedTargets: ScanHighlightTarget[] = [];
  const sortedTargets = [...targets].sort((left, right) => right.matched_text.length - left.matched_text.length);

  for (const target of sortedTargets) {
    if (!target.matched_text.trim()) {
      continue;
    }

    if (highlightAllMatches(target, documentRef) > 0) {
      appliedTargets.push(target);
    }
  }

  return appliedTargets;
}

export function clearPageHighlights(documentRef: Document = document): void {
  const highlights = documentRef.querySelectorAll<HTMLElement>(HIGHLIGHT_SELECTOR);
  for (const highlight of highlights) {
    const parent = highlight.parentNode;
    if (!parent) {
      continue;
    }

    parent.replaceChild(documentRef.createTextNode(highlight.textContent ?? ""), highlight);
    parent.normalize();
  }
}

function highlightAllMatches(target: ScanHighlightTarget, documentRef: Document): number {
  const roots = getHighlightRoots(target.block_id, documentRef);
  let appliedCount = 0;

  for (const root of roots) {
    const textNodes = findTextNodesWithMatch(root, target.matched_text);

    for (const textNode of textNodes) {
      appliedCount += highlightMatchesInTextNode(textNode, target, documentRef);
    }
  }

  return appliedCount;
}

function getHighlightRoots(blockId: string, documentRef: Document): HTMLElement[] {
  const body = documentRef.body;
  if (!body) {
    return [];
  }

  if (/^(?:jn|bg)-chat-\d+$/i.test(blockId)) {
    const messageRoot = documentRef.querySelector<HTMLElement>(
      `[data-message-id="${blockId}"], [data-chat-message][data-message-id="${blockId}"]`,
    );

    if (messageRoot) {
      return [messageRoot];
    }

    const chatThreadRoots = getUniqueElements(documentRef, [
      "[data-safe-ticket-chat] [data-chat-message]",
      "[data-safe-ticket-chat] [class*='bubble']",
      "[data-safe-ticket-chat] [data-message-id]",
    ]);

    return chatThreadRoots.length ? chatThreadRoots : [body];
  }

  if (blockId === "title") {
    const titleRoots = getUniqueElements(documentRef, [
      "h1",
      "[data-product-title]",
      "[class*='_productName_']",
      "[class*='product-name']",
      "[class*='title']",
    ]);
    return titleRoots.length ? titleRoots : [body];
  }

  if (blockId === "body-1") {
    const hostname = documentRef.location?.hostname ?? "";
    const selectors = /joongna/i.test(hostname)
      ? [
          "[data-safe-ticket-body-root]",
          "p.whitespace-pre-line",
          "p[class*='whitespace-pre-line']",
          "[data-product-description]",
          "[class*='product-content']",
          "[class*='product-detail'] p",
          "[class*='product-detail'] span",
          "[class*='detail'] [class*='content']",
          "[class*='detail-content'] p",
          "[class*='description']",
          "[class*='description'] p",
        ]
      : /bunjang/i.test(hostname)
        ? [
          "[data-safe-ticket-body-root]",
          "p[class*='_description_']",
          "[data-product-description]",
          "[class*='product-content']",
          "[class*='product-detail'] p",
          "[class*='detail'] [class*='content']",
          "[class*='detail-content'] p",
          "[class*='description']",
          "[class*='description'] p",
        ]
        : [
          "[data-safe-ticket-body-root]",
          "[data-product-description]",
          "p.whitespace-pre-line",
          "p[class*='_description_']",
          "[class*='product-content']",
          "[class*='product-detail'] p",
          "[class*='detail'] [class*='content']",
          "[class*='detail-content'] p",
          "[class*='description']",
          "[class*='description'] p",
        ];

    const scoped = getUniqueElements(documentRef, selectors);
    if (scoped.length) {
      return scoped;
    }

    const fallbackScoped = getUniqueElements(documentRef, [
      "main article",
      "main section",
      "article",
      "[role='main']",
      "main",
    ]);
    return fallbackScoped.length ? fallbackScoped : [body];
  }

  return [body];
}

function getUniqueElements(documentRef: Document, selectors: string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const matches: HTMLElement[] = [];

  for (const selector of selectors) {
    for (const element of Array.from(documentRef.querySelectorAll<HTMLElement>(selector))) {
      if (seen.has(element) || element.closest(`#${EXTENSION_ROOT_ID}`)) {
        continue;
      }

      seen.add(element);
      matches.push(element);
    }
  }

  return matches;
}

function highlightMatchesInTextNode(
  textNode: Text,
  target: ScanHighlightTarget,
  documentRef: Document,
): number {
  const originalText = textNode.nodeValue ?? "";
  const ranges = findAllMatchRanges(originalText, target.matched_text);

  if (!ranges.length) {
    return 0;
  }

  const fragment = documentRef.createDocumentFragment();
  let cursor = 0;

  for (const range of ranges) {
    if (range.index < cursor) {
      continue;
    }

    if (range.index > cursor) {
      fragment.appendChild(documentRef.createTextNode(originalText.slice(cursor, range.index)));
    }

    const wrapper = documentRef.createElement("mark");
    wrapper.className = target.css_class;
    wrapper.dataset.safeTicketHighlight = "true";
    wrapper.dataset.reasonCode = target.reason_code;
    wrapper.title = target.reason;
    wrapper.textContent = originalText.slice(range.index, range.index + range.length);
    fragment.appendChild(wrapper);

    cursor = range.index + range.length;
  }

  if (cursor < originalText.length) {
    fragment.appendChild(documentRef.createTextNode(originalText.slice(cursor)));
  }

  textNode.parentNode?.replaceChild(fragment, textNode);
  return ranges.length;
}

function findTextNodesWithMatch(
  root: HTMLElement | null,
  matchedText: string,
): Text[] {
  if (!root) {
    return [];
  }

  const documentRef = root.ownerDocument;
  const walker = documentRef.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.nodeValue ?? "";
        if (!findAllMatchRanges(text, matchedText).length) {
          return NodeFilter.FILTER_SKIP;
        }

        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_SKIP;
        }

        if (parent.closest(`#${EXTENSION_ROOT_ID}`)) {
          return NodeFilter.FILTER_SKIP;
        }

        if (parent.closest(HIGHLIGHT_SELECTOR)) {
          return NodeFilter.FILTER_SKIP;
        }

        const blockedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);
        if (blockedTags.has(parent.tagName)) {
          return NodeFilter.FILTER_SKIP;
        }

        if (isBlockedHighlightContext(parent, root)) {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const matches: Text[] = [];
  let currentNode = walker.nextNode() as Text | null;
  while (currentNode) {
    matches.push(currentNode);
    currentNode = walker.nextNode() as Text | null;
  }

  return matches;
}

function findAllMatchRanges(text: string, matchedText: string): Array<{ index: number; length: number }> {
  const directMatches: Array<{ index: number; length: number }> = [];
  let directCursor = 0;

  while (directCursor < text.length) {
    const directIndex = text.indexOf(matchedText, directCursor);
    if (directIndex < 0) {
      break;
    }

    directMatches.push({
      index: directIndex,
      length: matchedText.length,
    });
    directCursor = directIndex + Math.max(1, matchedText.length);
  }

  if (directMatches.length) {
    return directMatches;
  }

  const normalizedNeedle = normalizeWhitespace(matchedText);
  if (!normalizedNeedle) {
    return [];
  }

  const regex = buildWhitespaceTolerantRegex(matchedText);
  if (!regex) {
    return [];
  }

  const matches: Array<{ index: number; length: number }> = [];
  const globalRegex = new RegExp(regex.source, "g");
  let match = globalRegex.exec(text);

  while (match && match.index >= 0) {
    const matchedSegment = match[0];
    if (normalizeWhitespace(matchedSegment) === normalizedNeedle) {
      matches.push({
        index: match.index,
        length: matchedSegment.length,
      });
    }

    if (matchedSegment.length === 0) {
      globalRegex.lastIndex += 1;
    }

    match = globalRegex.exec(text);
  }

  return matches;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildWhitespaceTolerantRegex(value: string): RegExp | null {
  const parts = normalizeWhitespace(value)
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("\\s+"));
}

function isBlockedHighlightContext(element: HTMLElement, root: HTMLElement): boolean {
  if (root.contains(element)) {
    return false;
  }

  return Boolean(
    element.closest(
      [
        "nav",
        "header",
        "footer",
        "aside",
        "[role='navigation']",
        "[aria-label*='breadcrumb' i]",
        "[class*='breadcrumb']",
        "[class*='recommend']",
        "[class*='related']",
        "[class*='similar']",
        "[class*='carousel']",
        "[class*='swiper']",
        "[class*='banner']",
        "[class*='ad']",
      ].join(", "),
    ),
  );
}
