export type ReportView = "dashboard" | "reports" | "settings";

export interface ReportRoute {
  view: ReportView;
  scanId: string | null;
}

function getRouteSearchParams(normalizedHash: string, pageSearch: string): URLSearchParams {
  const hashSearchIndex = normalizedHash.indexOf("?");

  if (hashSearchIndex >= 0) {
    return new URLSearchParams(normalizedHash.slice(hashSearchIndex + 1));
  }

  return new URLSearchParams(pageSearch);
}

function getHashPath(normalizedHash: string): string {
  const hashSearchIndex = normalizedHash.indexOf("?");
  return hashSearchIndex >= 0 ? normalizedHash.slice(0, hashSearchIndex) : normalizedHash;
}

export function shouldRefreshReportData(current: ReportRoute, next: ReportRoute): boolean {
  return current.view !== next.view || current.scanId !== next.scanId;
}

export function buildRouteHref(view: ReportView, scanId?: string | null): string {
  if (view === "reports") {
    return scanId ? `#/reports/${encodeURIComponent(scanId)}` : "#/reports";
  }

  if (view === "settings") {
    return "#/settings";
  }

  return scanId ? `#/dashboard?scanId=${encodeURIComponent(scanId)}` : "#/dashboard";
}

export function parseReportRoute(hash: string, search: string): ReportRoute {
  const normalizedHash = hash.replace(/^#/, "");
  const normalizedPath = getHashPath(normalizedHash);
  const routeSearchParams = getRouteSearchParams(normalizedHash, search);

  const reportsMatch = normalizedPath.match(/^\/reports\/([^/?]+)/);
  if (reportsMatch?.[1]) {
    return {
      view: "reports",
      scanId: decodeURIComponent(reportsMatch[1]),
    };
  }

  const legacyReportMatch = normalizedPath.match(/^\/report\/([^/?]+)/);
  if (legacyReportMatch?.[1]) {
    return {
      view: "reports",
      scanId: decodeURIComponent(legacyReportMatch[1]),
    };
  }

  if (normalizedPath.startsWith("/reports")) {
    return {
      view: "reports",
      scanId: routeSearchParams.get("scanId"),
    };
  }

  if (normalizedPath.startsWith("/settings")) {
    return {
      view: "settings",
      scanId: null,
    };
  }

  return {
    view: "dashboard",
    scanId: routeSearchParams.get("scanId"),
  };
}
