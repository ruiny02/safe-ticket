import { afterEach, describe, expect, it, vi } from "vitest";

import { createScan, getCaseRiskMap } from "../../../../shared/scan-api";
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
  it("does not mark public server requests as private-network fetches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      text: async () => JSON.stringify({ scan_id: "scan_123", status: "queued", poll_after_ms: 1000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createScan("http://54.180.226.121:8000", payload);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit & { targetAddressSpace?: string };
    expect(requestInit.targetAddressSpace).toBeUndefined();
  });

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

  it("does not mark loopback compose requests as local-address-space fetches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      text: async () => JSON.stringify({ scan_id: "scan_123", status: "queued", poll_after_ms: 1000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createScan("http://localhost:8000", payload);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit & { targetAddressSpace?: string };
    expect(requestInit.targetAddressSpace).toBeUndefined();
  });

  it("passes scan id to the risk-map request for current scan overlays", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          model_version: "risk_space_test",
          projection_type: "pls7_umap_risk_aware_v1",
          mode: "embedding",
          score_aligned: false,
          x_axis: "pls7_umap_component_1",
          y_axis: "pls7_umap_component_2",
          z_axis: "pls7_umap_component_3",
          reducer: "umap",
          points: [],
          metrics: {},
          warnings: [],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getCaseRiskMap("http://localhost:8000", {
      dim: 3,
      mode: "embedding",
      reducer: "umap",
      projection: "pls7_umap",
      scanId: "scan_overlay",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:8000/api/v1/cases/risk-map?dim=3&mode=embedding&reducer=umap&projection=pls7_umap&limit=200&scan_id=scan_overlay",
    );
  });
});
