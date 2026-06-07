import { getSafeTicketFrontendBaseUrl } from "../../../shared/runtime-config";

export interface LatestScanState {
  pageUrl: string;
  scanId: string;
  frontendBaseUrl?: string;
}

export function buildDashboardBaseUrl(): string {
  return `${getSafeTicketFrontendBaseUrl()}/report/#/dashboard`;
}

export function buildSettingsPageUrl(): string {
  return `${getSafeTicketFrontendBaseUrl()}/report/#/settings`;
}

export function buildReportListUrl(): string {
  return `${getSafeTicketFrontendBaseUrl()}/report/#/reports`;
}

export function buildDashboardPageUrl(scanId: string): string {
  return `${buildDashboardBaseUrl()}?scanId=${encodeURIComponent(scanId)}`;
}

export function buildReportPageUrl(scanId: string): string {
  return `${buildReportListUrl()}/${encodeURIComponent(scanId)}`;
}

export function getReportPageUrlForTab(
  currentUrl: string,
  latestScan: LatestScanState | null,
): string | null {
  if (!latestScan) {
    return null;
  }

  if (latestScan.pageUrl !== currentUrl) {
    return null;
  }

  return buildReportPageUrl(latestScan.scanId);
}
