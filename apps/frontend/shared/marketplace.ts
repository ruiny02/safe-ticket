import {
  enhanceBunjangProductPayloadFromDocument,
  isReliableBunjangProductPayload,
  parseBunjangPageHtml,
} from "./bunjang";
import {
  buildScanPayload as buildJoongnaScanPayload,
  enhanceJoongnaProductPayloadFromDocument,
  isReliableJoongnaProductPayload,
  parseJoongnaPageHtml,
} from "./joonggonara";
import type { ScanCreateRequest } from "./types";

export function inferMarketplace(pageUrl: string, html: string): "joonggonara" | "bunjang" {
  const normalizedUrl = pageUrl.toLowerCase();

  if (
    normalizedUrl.includes("bunjang.co.kr") ||
    /data-platform="bunjang"|번개장터|번개톡/i.test(html)
  ) {
    return "bunjang";
  }

  return "joonggonara";
}

export function parseMarketplacePageHtml(html: string, pageUrl: string): ScanCreateRequest {
  return inferMarketplace(pageUrl, html) === "bunjang"
    ? parseBunjangPageHtml(html, pageUrl)
    : parseJoongnaPageHtml(html, pageUrl);
}

export function buildScanPayload(parsed: ScanCreateRequest): ScanCreateRequest {
  return buildJoongnaScanPayload(parsed);
}

export function enhanceMarketplacePayloadFromDocument(
  document: Document,
  payload: ScanCreateRequest,
): ScanCreateRequest {
  return payload.platform === "bunjang"
    ? enhanceBunjangProductPayloadFromDocument(document, payload)
    : enhanceJoongnaProductPayloadFromDocument(document, payload);
}

export function isReliableMarketplacePayload(payload: ScanCreateRequest): boolean {
  return isReliableJoongnaProductPayload(payload) && isReliableBunjangProductPayload(payload);
}
