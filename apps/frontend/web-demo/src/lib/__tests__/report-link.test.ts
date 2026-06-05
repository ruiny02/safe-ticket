import { describe, expect, it } from "vitest";

import { buildDashboardPageUrl, buildReportPageUrl, getReportPageUrlForTab } from "../report-link";

describe("report-link helpers", () => {
  it("builds the dashboard and report urls from a scan id", () => {
    expect(buildDashboardPageUrl("scan_1234")).toBe(
      "http://localhost:3000/report/#/dashboard?scanId=scan_1234",
    );
    expect(buildReportPageUrl("scan_1234")).toBe(
      "http://localhost:3000/report/#/reports/scan_1234",
    );
  });

  it("returns a report url only when the latest scan belongs to the current page", () => {
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
});
