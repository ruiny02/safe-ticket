const ROOT_ID = "safe-ticket-extension-root";

function getMountParent(): HTMLElement {
  return document.body ?? document.documentElement;
}

function appendRoot(root: HTMLElement) {
  const parent = getMountParent();

  if (root.parentElement !== parent) {
    parent.appendChild(root);
  }
}

export function ensureContentRoot(): HTMLElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    appendRoot(existing);
    return existing;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  appendRoot(root);
  return root;
}

export function keepContentRootMounted(root: HTMLElement): () => void {
  const observer = new MutationObserver(() => {
    if (!root.isConnected || root.parentElement !== getMountParent()) {
      appendRoot(root);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: false,
  });

  return () => {
    observer.disconnect();
  };
}
