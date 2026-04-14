const PANEL_EXPANDED_OFFSET = 392;
const PANEL_COLLAPSED_OFFSET = 96;
const MOBILE_BREAKPOINT = 1180;
const ORIGINAL_PADDING_KEY = "safeTicketOriginalPaddingRight";
const ORIGINAL_TRANSITION_KEY = "safeTicketOriginalTransition";

function ensureStoredBodyStyles(body: HTMLElement) {
  if (!body.dataset[ORIGINAL_PADDING_KEY]) {
    body.dataset[ORIGINAL_PADDING_KEY] = window.getComputedStyle(body).paddingRight;
  }

  if (!body.dataset[ORIGINAL_TRANSITION_KEY]) {
    body.dataset[ORIGINAL_TRANSITION_KEY] = body.style.transition || "";
  }
}

export function applyPanelLayout(collapsed: boolean) {
  const body = document.body;
  if (!body) {
    return;
  }

  ensureStoredBodyStyles(body);

  if (window.innerWidth < MOBILE_BREAKPOINT) {
    body.style.paddingRight = body.dataset[ORIGINAL_PADDING_KEY] ?? "";
    body.style.transition = body.dataset[ORIGINAL_TRANSITION_KEY] ?? "";
    return;
  }

  const originalPadding = body.dataset[ORIGINAL_PADDING_KEY] ?? "0px";
  const originalTransition = body.dataset[ORIGINAL_TRANSITION_KEY] ?? "";
  const offset = collapsed ? PANEL_COLLAPSED_OFFSET : PANEL_EXPANDED_OFFSET;

  body.style.paddingRight = `calc(${originalPadding} + ${offset}px)`;
  body.style.transition = originalTransition
    ? `${originalTransition}, padding-right 220ms ease`
    : "padding-right 220ms ease";
}

export function clearPanelLayout() {
  const body = document.body;
  if (!body) {
    return;
  }

  body.style.paddingRight = body.dataset[ORIGINAL_PADDING_KEY] ?? "";
  body.style.transition = body.dataset[ORIGINAL_TRANSITION_KEY] ?? "";
}
