export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PANEL_COLLAPSED_WIDTH = 92;
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MIN_HEIGHT = 460;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_MAX_HEIGHT = 960;
export const PANEL_MARGIN = 16;

export function createDefaultPanelRect(viewportWidth: number, viewportHeight: number): PanelRect {
  const width = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, viewportWidth * 0.3));
  const height = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, viewportHeight - PANEL_MARGIN * 2));

  return clampPanelRect(
    {
      x: Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN),
      y: PANEL_MARGIN,
      width,
      height,
    },
    viewportWidth,
    viewportHeight,
  );
}

export function clampPanelRect(
  rect: PanelRect,
  viewportWidth: number,
  viewportHeight: number,
): PanelRect {
  const width = Math.min(
    Math.max(PANEL_MIN_WIDTH, rect.width),
    Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, viewportWidth - PANEL_MARGIN * 2)),
  );
  const height = Math.min(
    Math.max(PANEL_MIN_HEIGHT, rect.height),
    Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, viewportHeight - PANEL_MARGIN * 2)),
  );

  const maxX = Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN);
  const maxY = Math.max(PANEL_MARGIN, viewportHeight - height - PANEL_MARGIN);

  return {
    x: Math.min(Math.max(PANEL_MARGIN, rect.x), maxX),
    y: Math.min(Math.max(PANEL_MARGIN, rect.y), maxY),
    width,
    height,
  };
}

export function movePanel(
  originRect: PanelRect,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): PanelRect {
  return clampPanelRect(
    {
      ...originRect,
      x: originRect.x + deltaX,
      y: originRect.y + deltaY,
    },
    viewportWidth,
    viewportHeight,
  );
}

export function resizePanel(
  originRect: PanelRect,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): PanelRect {
  return clampPanelRect(
    {
      ...originRect,
      width: originRect.width + deltaX,
      height: originRect.height + deltaY,
    },
    viewportWidth,
    viewportHeight,
  );
}
