import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";

function renderPanel(pageUrl: string) {
  vi.stubGlobal("window", {
    innerWidth: 1440,
    innerHeight: 900,
    location: {
      href: pageUrl,
    },
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
  });

  return renderToStaticMarkup(<App pageUrl={pageUrl} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safe-ticket panel", () => {
  it("opens by default on supported marketplace product pages", () => {
    const html = renderPanel("https://web.joongna.com/product/229579214");

    expect(html).toContain("safe-ticket-panel");
    expect(html).not.toContain("is-collapsed");
    expect(html).toContain("접기");
    expect(html).toContain("페이지 확인 중");
  });
});
