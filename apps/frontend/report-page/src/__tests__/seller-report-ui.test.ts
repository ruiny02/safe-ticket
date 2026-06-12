import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("seller report UI copy", () => {
  it("does not expose AI provider/source copy in the seller report card", () => {
    expect(appSource).not.toContain("Gemini 분석글");
    expect(appSource).not.toContain("<span>Source</span>");
    expect(appSource).not.toContain("report.source");
  });

  it("does not force a nested scroll area inside the seller report card", () => {
    expect(appSource).not.toContain("dashboard-seller-report-scroll");
    expect(stylesSource).not.toContain(".dashboard-seller-report-scroll");
  });
});
