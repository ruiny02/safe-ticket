import { afterEach, describe, expect, it, vi } from "vitest";

import { applyPanelLayout, clearPanelLayout } from "../page-layout";

function createFakeBody() {
  const classes = new Set<string>();
  const properties = new Map<string, string>();

  return {
    dataset: {} as Record<string, string>,
    style: {
      paddingRight: "",
      transition: "",
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
      getPropertyValue: (name: string) => properties.get(name) ?? "",
    },
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  } as unknown as HTMLElement & {
    style: CSSStyleDeclaration & {
      getPropertyValue: (name: string) => string;
    };
  };
}

function stubBrowser(body: HTMLElement, width: number) {
  vi.stubGlobal("document", { body });
  vi.stubGlobal("window", {
    innerWidth: width,
    getComputedStyle: () => ({ paddingRight: "8px" }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("page layout shift", () => {
  it("adds a page shift class and offset on desktop", () => {
    const body = createFakeBody();
    stubBrowser(body, 1440);

    applyPanelLayout(false);

    expect(body.classList.contains("safe-ticket-layout-shift")).toBe(true);
    expect(body.style.getPropertyValue("--safe-ticket-layout-offset")).toBe("424px");
    expect(body.style.paddingRight).toBe("calc(8px + 424px)");
  });

  it("removes the page shift when cleared or on mobile", () => {
    const body = createFakeBody();
    stubBrowser(body, 1440);
    applyPanelLayout(false);

    clearPanelLayout();

    expect(body.classList.contains("safe-ticket-layout-shift")).toBe(false);
    expect(body.style.getPropertyValue("--safe-ticket-layout-offset")).toBe("");

    stubBrowser(body, 800);
    applyPanelLayout(false);

    expect(body.classList.contains("safe-ticket-layout-shift")).toBe(false);
    expect(body.style.getPropertyValue("--safe-ticket-layout-offset")).toBe("");
  });
});
