# Demo Scan MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a demo-only parsing flow that reads the Joongna demo page, normalizes it into the `POST /api/v1/scans` payload, sends it to a temporary FastAPI backend, and verifies Docker-based frontend/backend communication without blocking future replacement by a separately built React web page and Chrome extension.

**Architecture:** Use a small frontend workspace that keeps page parsing and API transport in shared TypeScript modules, with the current milestone exposing those modules through a React demo page first. Keep the backend explicitly temporary by isolating it under a `demo_stub` path and implementing only request validation plus `202 Accepted` scan creation behavior, so it can be deleted cleanly when the real backend arrives.

**Tech Stack:** `pnpm` workspace, React, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, future-ready WXT extension slot, FastAPI, Uvicorn, Docker Compose.

---

## Decision Summary

### Recommended Approach

Use a **React + Vite web demo first**, but structure parser and scan client code as reusable modules that can later move unchanged into a Chrome extension.

Why this is the best MVP path:
- It gives a Docker-runnable frontend immediately.
- It avoids committing to an extension runtime before the real extension UI exists.
- It keeps the parser reusable for the future React web page and future Chrome extension.
- It keeps the temporary backend minimal and disposable.

### Alternatives Considered

#### 1. Extension-first MVP with WXT or Plasmo
- Pros: Closest to final runtime.
- Cons: Slower to demo, Docker verification does not cover the extension runtime well, and debugging is heavier for a temporary milestone.

#### 2. Ad-hoc static HTML + inline JavaScript
- Pros: Fastest to hack together.
- Cons: Hard to replace, no clean boundary for parser reuse, and poor fit for later React/Figma handoff.

The recommended path keeps YAGNI for the current demo while preserving the correct seams for replacement.

### Task 1: Frontend Workspace Direction

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `apps/frontend/web-demo/package.json`
- Create: `apps/frontend/web-demo/tsconfig.json`
- Create: `apps/frontend/web-demo/vite.config.ts`
- Create: `apps/frontend/web-demo/index.html`
- Create: `apps/frontend/web-demo/src/main.tsx`
- Create: `apps/frontend/web-demo/src/App.tsx`

**Step 1: Create the Node workspace shell**

Create a minimal `pnpm` workspace rooted at the repository so later web and extension apps can coexist cleanly.

**Step 2: Add only one runnable app in this milestone**

Create `apps/frontend/web-demo` as the only active Node app for now. Do not scaffold the extension app yet; leave that to the later milestone when the real Chrome extension UI arrives.

**Step 3: Keep the future extension slot implicit**

Plan for a future `apps/extension` app, but do not create it yet. The current milestone should only create reusable parser modules so the future extension can consume them.

**Step 4: Verification**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket/apps/frontend/web-demo
pnpm install
pnpm build
```

Expected:
- Dependencies install successfully
- Vite production build completes

### Task 2: Reusable Parser and Scan Payload Modules

**Files:**
- Create: `apps/frontend/web-demo/src/lib/adapters/joonggonara.ts`
- Create: `apps/frontend/web-demo/src/lib/scan-payload.ts`
- Create: `apps/frontend/web-demo/src/lib/types.ts`
- Create: `apps/frontend/web-demo/src/lib/api.ts`
- Test: `apps/frontend/web-demo/src/lib/__tests__/joonggonara.test.ts`

**Step 1: Define the transport types**

Create TypeScript types that mirror the current backend document contract for `POST /api/v1/scans`.

Required fields:
- `platform`
- `page_url`
- `page_title`
- `price`
- `seller`
- `content_blocks`

**Step 2: Implement a page adapter**

Build a Joongna-specific adapter that accepts a `Document` and extracts:
- title
- price
- seller nickname
- seller id if derivable
- product description paragraph

The adapter should return a raw parsed object, not the final API payload.

**Step 3: Implement a normalizer**

Convert the raw parsed object into the exact `POST /api/v1/scans` payload shape.

For MVP:
- `platform = "joonggonara"`
- `content_blocks = [{ block_id: "title", ... }, { block_id: "body-1", ... }]`
- split only title and one main body block

**Step 4: Add tests for the parser**

Use fixture HTML copied from the current demo page and verify the normalized payload fields.

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket/apps/frontend/web-demo
pnpm test joonggonara
```

Expected:
- parser extracts the expected title, price, seller, and body text

### Task 3: Demo Web App for Parse + Submit

**Files:**
- Create: `apps/frontend/web-demo/src/routes/demo-page.tsx`
- Create: `apps/frontend/web-demo/src/components/scan-submit-panel.tsx`
- Create: `apps/frontend/web-demo/src/components/payload-preview.tsx`
- Modify: `apps/frontend/web-demo/src/App.tsx`

**Step 1: Mount the demo page route**

Expose a route that renders the Joongna demo HTML inside the frontend app context, or loads it in a controlled container for parsing.

**Step 2: Add a parse action**

Provide a `Parse Page` button that:
- reads the demo page DOM
- runs the adapter
- shows the normalized payload preview

**Step 3: Add a submit action**

Provide a `Send Scan Request` button that calls `POST /api/v1/scans`.

The page should display:
- request JSON preview
- response JSON preview
- request status

**Step 4: Keep UI disposable**

Use plain React + Tailwind components only. Avoid building any product-specific design system in this milestone because the page will later be replaced by Figma-derived React UI.

**Step 5: Verification**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket/apps/frontend/web-demo
pnpm dev
```

Expected:
- the page loads
- parse preview shows the current demo payload
- submit action hits the backend and renders the returned `scan_id`

### Task 4: Temporary FastAPI Scan Stub

**Files:**
- Create: `apps/backend/demo_stub/__init__.py`
- Create: `apps/backend/demo_stub/main.py`
- Create: `apps/backend/demo_stub/schemas.py`
- Create: `apps/backend/demo_stub/requirements.txt`
- Test: `apps/backend/demo_stub/tests/test_scans.py`
- Modify: `docker/backend.Dockerfile`

**Step 1: Isolate the temporary backend**

Keep the demo backend under `apps/backend/demo_stub/` so it is visually and operationally separate from the future real backend.

**Step 2: Implement only the minimum API surface**

Required endpoint:
- `POST /api/v1/scans`

Optional but useful:
- `GET /api/v1/health/live`

For MVP behavior:
- validate request body
- log received payload
- return `202 Accepted`
- return `scan_id`, `status = "queued"`, `poll_after_ms = 2000`

Do not implement:
- DB persistence
- polling result storage
- retrieval
- LLM integration

**Step 3: Make deletion easy**

Add a header comment in `main.py` and `Dockerfile` stating that this is a temporary demo stub and can be removed once the real backend is introduced.

**Step 4: Verification**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
pytest apps/backend/demo_stub/tests/test_scans.py -v
```

Expected:
- valid payload returns `202`
- invalid payload returns validation error

### Task 5: Docker Wiring and End-to-End Verification

**Files:**
- Modify: `docker/backend.Dockerfile`
- Modify: `docker/frontend.Dockerfile`
- Modify: `docker-compose.yml`

**Step 1: Backend container**

Replace placeholder HTTP server with:

```bash
uvicorn apps.backend.demo_stub.main:app --host 0.0.0.0 --port 8000
```

or equivalent module path that matches the final file placement.

**Step 2: Frontend container**

Replace the static Nginx placeholder with a Node-based frontend runtime appropriate for Vite build or preview mode.

For MVP:
- simplest acceptable target is Vite preview in-container
- keep the container focused on demo delivery, not production hardening

**Step 3: Compose environment**

Expose:
- frontend on `3000`
- backend on `8000`

Backend CORS must allow:
- `http://localhost:3000`
- `http://127.0.0.1:3000`

**Step 4: End-to-end manual verification**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
docker compose up --build
```

Then verify:
1. Open the frontend page in the browser.
2. Trigger parsing on the Joongna demo page.
3. Confirm the payload matches the documented API contract.
4. Submit the request.
5. Confirm the backend logs the request and returns `202`.

**Step 5: Completion criteria**

This milestone is complete when:
- the frontend generates the documented `POST /api/v1/scans` payload
- the temporary FastAPI backend accepts it
- Docker Compose can bring up the demo stack
- the temporary backend is isolated enough to be deleted later without touching parser logic
