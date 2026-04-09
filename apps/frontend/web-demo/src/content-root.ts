const ROOT_ID = "safe-ticket-extension-root";

export function ensureContentRoot(): HTMLElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    return existing;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  document.body.appendChild(root);
  return root;
}
