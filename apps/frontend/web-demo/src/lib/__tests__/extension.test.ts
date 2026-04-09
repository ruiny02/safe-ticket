import { describe, expect, it } from "vitest";

import {
  getSupportedJoongnaPageStatus,
  isSupportedJoongnaPage,
} from "../../../../shared/page-target";

describe("isSupportedJoongnaPage", () => {
  it("accepts the local demo page and production joongna product pages", () => {
    expect(isSupportedJoongnaPage("http://localhost:3000/product/227242032.html")).toBe(true);
    expect(isSupportedJoongnaPage("https://web.joongna.com/product/227242032")).toBe(true);
  });

  it("rejects unrelated pages", () => {
    expect(isSupportedJoongnaPage("http://localhost:3000/")).toBe(false);
    expect(isSupportedJoongnaPage("https://example.com/product/227242032")).toBe(false);
  });
});

describe("getSupportedJoongnaPageStatus", () => {
  it("returns a ready status message for supported pages", () => {
    expect(getSupportedJoongnaPageStatus("http://localhost:3000/product/227242032.html")).toEqual(
      {
        supported: true,
        label: "이 페이지에서 스캔이 동작합니다.",
      },
    );
  });

  it("returns a guidance message for unsupported pages", () => {
    expect(getSupportedJoongnaPageStatus("http://localhost:3000/")).toEqual({
      supported: false,
      label: "중고나라 상품 상세 페이지를 열면 패널이 자동으로 나타납니다.",
    });
  });
});
