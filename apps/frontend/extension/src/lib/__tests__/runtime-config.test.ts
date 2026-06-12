import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDefaultApiBaseUrl,
  buildDefaultFrontendBaseUrl,
  resolveApiBaseUrl,
  resolveFrontendBaseUrl,
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
        hostname: "203.0.113.10",
        host: "203.0.113.10:3000",
        port: "3000",
        protocol: "http:",
      },
    });

    expect(buildDefaultApiBaseUrl()).toBe("http://203.0.113.10:8000");
    expect(buildDefaultFrontendBaseUrl()).toBe("http://203.0.113.10:3000");
  });

  it("ignores loopback build-time URLs on public hosted pages", () => {
    vi.stubGlobal("window", {
      location: {
        hostname: "203.0.113.10",
        host: "203.0.113.10:3000",
        port: "3000",
        protocol: "http:",
      },
    });

    expect(resolveApiBaseUrl("http://localhost:8000")).toBe("http://203.0.113.10:8000");
    expect(resolveApiBaseUrl("http://127.0.0.1:8000")).toBe("http://203.0.113.10:8000");
    expect(resolveFrontendBaseUrl("http://localhost:3000")).toBe("http://203.0.113.10:3000");
  });

  it("keeps explicit public build-time URLs on hosted pages", () => {
    vi.stubGlobal("window", {
      location: {
        hostname: "203.0.113.10",
        host: "203.0.113.10:3000",
        port: "3000",
        protocol: "http:",
      },
    });

    expect(resolveApiBaseUrl("http://api.safe-ticket.example:8000")).toBe(
      "http://api.safe-ticket.example:8000",
    );
    expect(resolveFrontendBaseUrl("http://safe-ticket.example:3000")).toBe(
      "http://safe-ticket.example:3000",
    );
  });
});
