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

export function applyPageHighlights(targets: ScanHighlightTarget[], documentRef: Document = document): void {
  clearPageHighlights(documentRef);

  for (const target of targets) {
    if (!target.matched_text.trim()) {
      continue;
    }

    highlightFirstMatch(target, documentRef);
  }
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

function highlightFirstMatch(target: ScanHighlightTarget, documentRef: Document): void {
  const textNode = findTextNodeWithMatch(documentRef.body, target.matched_text);
  if (!textNode) {
    return;
  }

  const originalText = textNode.nodeValue ?? "";
  const matchIndex = originalText.indexOf(target.matched_text);
  if (matchIndex < 0) {
    return;
  }

  const before = originalText.slice(0, matchIndex);
  const match = originalText.slice(matchIndex, matchIndex + target.matched_text.length);
  const after = originalText.slice(matchIndex + target.matched_text.length);

  const wrapper = documentRef.createElement("mark");
  wrapper.className = target.css_class;
  wrapper.dataset.safeTicketHighlight = "true";
  wrapper.dataset.reasonCode = target.reason_code;
  wrapper.title = target.reason;
  wrapper.textContent = match;

  const fragment = documentRef.createDocumentFragment();
  if (before) {
    fragment.appendChild(documentRef.createTextNode(before));
  }
  fragment.appendChild(wrapper);
  if (after) {
    fragment.appendChild(documentRef.createTextNode(after));
  }

  textNode.parentNode?.replaceChild(fragment, textNode);
}

function findTextNodeWithMatch(root: HTMLElement | null, matchedText: string): Text | null {
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
        if (!text.includes(matchedText)) {
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

  return walker.nextNode() as Text | null;
}
