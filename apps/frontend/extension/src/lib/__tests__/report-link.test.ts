import { describe, expect, it } from "vitest";

import { buildDashboardPageUrl, buildReportPageUrl, getReportPageUrlForTab } from "../report-link";

describe("report links", () => {
  it("builds report and dashboard URLs for a scan", () => {
    expect(buildReportPageUrl("scan_1234")).toBe("http://localhost:3000/report/#/reports/scan_1234");
    expect(buildDashboardPageUrl("scan_1234")).toBe("http://localhost:3000/report/#/dashboard?scanId=scan_1234");
  });

  it("returns the report URL only for the tab that produced the scan", () => {
    expect(
      getReportPageUrlForTab("http://localhost:3000/product/227242032.html", {
        pageUrl: "http://localhost:3000/product/227242032.html",
        scanId: "scan_1234",
      }),
    ).toBe("http://localhost:3000/report/#/reports/scan_1234");

    expect(
      getReportPageUrlForTab("http://localhost:3000/product/227242032.html", {
        pageUrl: "http://localhost:3000/product/999999999.html",
        scanId: "scan_1234",
      }),
    ).toBeNull();
  });

  it("encodes scan IDs safely", () => {
    expect(buildReportPageUrl("scan 1234")).toBe("http://localhost:3000/report/#/reports/scan%201234");
  });
});
