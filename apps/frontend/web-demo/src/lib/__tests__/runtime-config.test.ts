import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDefaultApiBaseUrl,
  buildDefaultFrontendBaseUrl,
} from "../../../../shared/runtime-config";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runtime config defaults", () => {
  it("uses local docker compose URLs for localhost pages", () => {
    vi.stubGlobal("window", {
      location: {
        hostname: "localhost",
        host: "localhost:3000",
        protocol: "http:",
      },
    });

    expect(buildDefaultApiBaseUrl()).toBe("http://localhost:8000");
    expect(buildDefaultFrontendBaseUrl()).toBe("http://localhost:3000");
  });

  it("uses the hosted safe-ticket origin for public demo/report pages", () => {
    vi.stubGlobal("window", {
      location: {
        hostname: "54.180.226.121",
        host: "54.180.226.121:3000",
        port: "3000",
        protocol: "http:",
      },
    });

    expect(buildDefaultApiBaseUrl()).toBe("http://54.180.226.121:8000");
    expect(buildDefaultFrontendBaseUrl()).toBe("http://54.180.226.121:3000");
  });
});
