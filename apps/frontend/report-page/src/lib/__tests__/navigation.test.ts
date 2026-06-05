import { describe, expect, it } from "vitest";

import { buildRouteHref, parseReportRoute, shouldRefreshReportData } from "../navigation";

describe("parseReportRoute", () => {
  it("defaults to dashboard when there is no hash route", () => {
    expect(parseReportRoute("", "")).toEqual({
      view: "dashboard",
      scanId: null,
    });
  });

  it("parses reports routes and legacy report routes with scan ids", () => {
    expect(parseReportRoute("#/reports/scan_1234", "")).toEqual({
      view: "reports",
      scanId: "scan_1234",
    });

    expect(parseReportRoute("#/report/scan_legacy", "")).toEqual({
      view: "reports",
      scanId: "scan_legacy",
    });
  });

  it("parses settings route", () => {
    expect(parseReportRoute("#/settings", "")).toEqual({
      view: "settings",
      scanId: null,
    });
  });

  it("preserves scan ids encoded in hash query for non-report routes", () => {
    expect(parseReportRoute("#/dashboard?scanId=scan_65efe38f", "")).toEqual({
      view: "dashboard",
      scanId: "scan_65efe38f",
    });

    expect(parseReportRoute("#/reports?scanId=scan_65efe38f", "")).toEqual({
      view: "reports",
      scanId: "scan_65efe38f",
    });
  });

  it("does not refresh report data when the normalized route stays the same", () => {
    expect(
      shouldRefreshReportData(
        { view: "reports", scanId: "scan_93b525d1" },
        { view: "reports", scanId: "scan_93b525d1" },
      ),
    ).toBe(false);
  });

  it("refreshes report data when the scan id changes", () => {
    expect(
      shouldRefreshReportData(
        { view: "reports", scanId: "scan_a" },
        { view: "reports", scanId: "scan_b" },
      ),
    ).toBe(true);
  });

  it("builds route hrefs that preserve the active scan id across views", () => {
    expect(buildRouteHref("dashboard", "scan_65efe38f")).toBe("#/dashboard?scanId=scan_65efe38f");
    expect(buildRouteHref("reports", "scan_65efe38f")).toBe("#/reports/scan_65efe38f");
    expect(buildRouteHref("settings")).toBe("#/settings");
  });
});
