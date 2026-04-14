import { describe, expect, it } from "vitest";

import { buildReportPageUrl, getReportPageUrlForTab } from "../report-link";

describe("report-link helpers", () => {
  it("builds the report page url from a scan id", () => {
    expect(buildReportPageUrl("scan_1234")).toBe("http://localhost:3000/report/#/report/scan_1234");
  });

  it("returns a report url only when the latest scan belongs to the current page", () => {
    expect(
      getReportPageUrlForTab("http://localhost:3000/product/227242032.html", {
        pageUrl: "http://localhost:3000/product/227242032.html",
        scanId: "scan_1234",
      }),
    ).toBe("http://localhost:3000/report/#/report/scan_1234");

    expect(
      getReportPageUrlForTab("http://localhost:3000/product/227242032.html", {
        pageUrl: "http://localhost:3000/product/999999999.html",
        scanId: "scan_1234",
      }),
    ).toBeNull();
  });
});
