export interface LatestScanState {
  pageUrl: string;
  scanId: string;
}

export function buildDashboardPageUrl(scanId: string): string {
  return `http://localhost:3000/report/#/dashboard?scanId=${encodeURIComponent(scanId)}`;
}

export function buildReportPageUrl(scanId: string): string {
  return `http://localhost:3000/report/#/reports/${encodeURIComponent(scanId)}`;
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
