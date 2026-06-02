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

  for (const target of targets) {
    if (!target.matched_text.trim()) {
      continue;
    }

    if (highlightFirstMatch(target, documentRef)) {
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

function highlightFirstMatch(target: ScanHighlightTarget, documentRef: Document): boolean {
  const match = findTextNodeWithMatch(documentRef.body, target.matched_text);
  if (!match) {
    return false;
  }

  const { textNode, matchIndex, matchLength } = match;
  const originalText = textNode.nodeValue ?? "";
  const before = originalText.slice(0, matchIndex);
  const matchText = originalText.slice(matchIndex, matchIndex + matchLength);
  const after = originalText.slice(matchIndex + matchLength);

  const wrapper = documentRef.createElement("mark");
  wrapper.className = target.css_class;
  wrapper.dataset.safeTicketHighlight = "true";
  wrapper.dataset.reasonCode = target.reason_code;
  wrapper.title = target.reason;
  wrapper.textContent = matchText;

  const fragment = documentRef.createDocumentFragment();
  if (before) {
    fragment.appendChild(documentRef.createTextNode(before));
  }
  fragment.appendChild(wrapper);
  if (after) {
    fragment.appendChild(documentRef.createTextNode(after));
  }

  textNode.parentNode?.replaceChild(fragment, textNode);
  return true;
}

function findTextNodeWithMatch(
  root: HTMLElement | null,
  matchedText: string,
): { textNode: Text; matchIndex: number; matchLength: number } | null {
  if (!root) {
    return null;
  }

  const documentRef = root.ownerDocument;
  const walker = documentRef.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.nodeValue ?? "";
        if (!findMatchRange(text, matchedText)) {
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

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let currentNode = walker.nextNode() as Text | null;
  while (currentNode) {
    const text = currentNode.nodeValue ?? "";
    const range = findMatchRange(text, matchedText);
    if (range) {
      return {
        textNode: currentNode,
        matchIndex: range.index,
        matchLength: range.length,
      };
    }

    currentNode = walker.nextNode() as Text | null;
  }

  return null;
}

function findMatchRange(text: string, matchedText: string): { index: number; length: number } | null {
  const directIndex = text.indexOf(matchedText);
  if (directIndex >= 0) {
    return {
      index: directIndex,
      length: matchedText.length,
    };
  }

  const normalizedNeedle = normalizeWhitespace(matchedText);
  if (!normalizedNeedle) {
    return null;
  }

  const regex = buildWhitespaceTolerantRegex(matchedText);
  if (!regex) {
    return null;
  }

  const match = regex.exec(text);
  if (!match || match.index < 0) {
    return null;
  }

  const matchedSegment = match[0];
  if (normalizeWhitespace(matchedSegment) !== normalizedNeedle) {
    return null;
  }

  return {
    index: match.index,
    length: matchedSegment.length,
  };
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
