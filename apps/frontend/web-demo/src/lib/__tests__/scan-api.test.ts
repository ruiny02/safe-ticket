import { afterEach, describe, expect, it, vi } from "vitest";

import { createScan } from "../../../../shared/scan-api";
import type { ScanCreateRequest } from "../../../../shared/types";

const payload: ScanCreateRequest = {
  platform: "joonggonara",
  page_url: "https://web.joongna.com/product/227242032",
  page_title: "테스트 상품",
  price: 100000,
  seller: {
    seller_id: "seller-1",
    nickname: "테스트판매자",
  },
  content_blocks: [],
  marketplace_signals: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scan-api helpers", () => {
  it("does not fall back to a hard-coded remote tunnel when local scan requests fail", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createScan("http://127.0.0.1:8000", payload)).rejects.toThrow("network down");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:8000/api/v1/scans",
      "http://localhost:8000/api/v1/scans",
    ]);
  });
});
