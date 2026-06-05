import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../App";

function renderWithHash(hash = "", search = "") {
  const previousWindow = (globalThis as { window?: Window }).window;

  (globalThis as { window?: Window }).window = {
    location: {
      hash,
      search,
    },
  } as unknown as Window;

  const html = renderToStaticMarkup(<App />);

  if (previousWindow) {
    (globalThis as { window?: Window }).window = previousWindow;
  } else {
    delete (globalThis as { window?: Window }).window;
  }

  return html;
}

describe("report page shell", () => {
  it("renders the main dashboard without the intelligence section or account footer", () => {
    const html = renderWithHash("#/dashboard");

    expect(html).toContain("Safety center");
    expect(html).toContain("Dashboard");
    expect(html).toContain("Reports");
    expect(html).toContain("Settings");
    expect(html).toContain("Pages");
    expect(html).not.toContain(">Main<");
    expect(html).not.toContain("Intelligence");
    expect(html).not.toContain("Scan workspace");
    expect(html).toContain("Risk overview");
    expect(html).toContain("Top signals");
  });

  it("renders a reports index when no scan id is selected and shows the account footer", () => {
    const html = renderWithHash("#/reports");

    expect(html).toContain("Reports");
    expect(html).toContain("Recent reports");
    expect(html).toContain("safe-ticket");
    expect(html).toContain("Scan workspace");
  });
});
