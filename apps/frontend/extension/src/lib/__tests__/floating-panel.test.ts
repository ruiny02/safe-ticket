import { describe, expect, it } from "vitest";

import {
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  clampPanelRect,
  createDefaultPanelRect,
  movePanel,
  resizePanel,
} from "../floating-panel";

describe("floating-panel helpers", () => {
  it("creates a default panel within the viewport", () => {
    const rect = createDefaultPanelRect(1440, 900);

    expect(rect.width).toBeGreaterThanOrEqual(PANEL_MIN_WIDTH);
    expect(rect.height).toBeGreaterThanOrEqual(PANEL_MIN_HEIGHT);
    expect(rect.x).toBeGreaterThanOrEqual(16);
    expect(rect.y).toBeGreaterThanOrEqual(16);
  });

  it("clamps panel movement within the viewport", () => {
    const rect = movePanel(
      { x: 100, y: 100, width: 360, height: 520 },
      2000,
      -2000,
      1280,
      720,
    );

    expect(rect.x).toBeLessThanOrEqual(1280 - rect.width - 16);
    expect(rect.y).toBeGreaterThanOrEqual(16);
  });

  it("clamps panel resize within min and max bounds", () => {
    const rect = resizePanel(
      { x: 100, y: 100, width: 360, height: 520 },
      -400,
      -400,
      1280,
      720,
    );

    expect(rect.width).toBe(PANEL_MIN_WIDTH);
    expect(rect.height).toBe(PANEL_MIN_HEIGHT);
  });

  it("normalizes arbitrary rects", () => {
    const rect = clampPanelRect(
      { x: -100, y: -100, width: 900, height: 1200 },
      1024,
      768,
    );

    expect(rect.x).toBeGreaterThanOrEqual(16);
    expect(rect.y).toBeGreaterThanOrEqual(16);
    expect(rect.width).toBeLessThanOrEqual(1024 - 32);
    expect(rect.height).toBeLessThanOrEqual(768 - 32);
  });
});
