# Chrome Extension Overlay MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the current `apps/frontend/web-demo` frontend into a Chrome extension MVP that parses the Joongna product page in-place and sends `POST /api/v1/scans` to the temporary FastAPI backend.

**Architecture:** Keep all parser and API contract code in `apps/frontend/shared`, and replace the standalone React page with a React content-script overlay. Serve the Joongna demo page separately through Docker so the extension can be loaded unpacked in Chrome and exercised against a real page URL.

**Tech Stack:** Vite, React, TypeScript, Chrome Extension Manifest V3, FastAPI, Docker Compose

---

### Task 1: Add extension-specific tests and helpers

**Files:**
- Create: `apps/frontend/web-demo/src/lib/__tests__/extension.test.ts`
- Create: `apps/frontend/shared/page-target.ts`

**Intent:**
- Define which URLs the extension should activate on.
- Keep page-target logic pure and reusable.

### Task 2: Replace the standalone React app with a content-script overlay

**Files:**
- Modify: `apps/frontend/web-demo/src/main.tsx`
- Replace: `apps/frontend/web-demo/src/App.tsx`
- Modify: `apps/frontend/web-demo/src/styles.css`
- Create: `apps/frontend/web-demo/src/content-root.ts`

**Intent:**
- Inject a fixed overlay into supported pages.
- Parse the current document HTML instead of fetching a separate page.
- Send scans directly from the content script and render response state in-page.

### Task 3: Turn the Vite project into a loadable Chrome extension build

**Files:**
- Modify: `apps/frontend/web-demo/package.json`
- Modify: `apps/frontend/web-demo/vite.config.ts`
- Create: `apps/frontend/web-demo/manifest.json`

**Intent:**
- Output stable `content.js` and `content.css` files into `dist/`.
- Emit a Manifest V3 extension that can be loaded unpacked in Chrome.

### Task 4: Make the backend accept extension-origin requests

**Files:**
- Modify: `apps/backend/demo_stub/main.py`
- Modify: `apps/backend/demo_stub/tests/test_scans.py`

**Intent:**
- Allow `chrome-extension://...` preflight requests.
- Preserve the existing demo `POST /api/v1/scans` behavior.

### Task 5: Serve the Joongna demo page as the runtime target

**Files:**
- Modify: `docker/frontend.Dockerfile`
- Modify: `docker-compose.yml`

**Intent:**
- Replace the old React dev-server container with a simple static server for `apps/frontend/demo/joongna-product-demo`.
- Keep the backend in Docker so the extension can call it at `http://localhost:8000`.

### Task 6: Document how to load and run the extension MVP

**Files:**
- Modify: `docs/frontend/extension.md`
- Optionally modify: `docs/README.md`

**Intent:**
- Document `pnpm build`, Chrome “Load unpacked”, demo page URL, and backend startup.
