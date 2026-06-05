# Report Embedding Clusters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich the report page embedding visualization with a dense synthetic 2D dataset that visually separates fraud-like, safe, and borderline clusters around the current post.

**Architecture:** Keep the backend API unchanged and generate deterministic demo-only cluster points in the report-page dashboard model. Extend the existing SVG card to render many points, a cluster legend, and relative distance messaging without changing the rest of the report flow.

**Tech Stack:** React, TypeScript, Vitest, Vite

---

### Task 1: Lock the expected embedding model behavior

**Files:**
- Modify: `apps/frontend/report-page/src/lib/__tests__/dashboard-model.test.ts`
- Modify: `apps/frontend/report-page/src/lib/dashboard-model.ts`

**Step 1: Write the failing test**
- Add assertions that `buildDashboardModel()` returns many embedding points instead of only current+cases.
- Assert that the embedding result includes at least one `fraud`, one `safe`, one `borderline`, and one `current` point.
- Assert that the current post remains present and that cluster counts are stable enough for the demo.

**Step 2: Run test to verify it fails**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: the new embedding assertions fail because the current model only returns sparse points.

**Step 3: Write minimal implementation**
- Extend the embedding model types and generator logic in `dashboard-model.ts`.
- Use deterministic synthetic coordinates so tests are stable.

**Step 4: Run test to verify it passes**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: all tests pass.

### Task 2: Upgrade the SVG card and explanatory UI

**Files:**
- Modify: `apps/frontend/report-page/src/App.tsx`
- Modify: `apps/frontend/report-page/src/styles.css`

**Step 1: Write the failing shell test**
- Extend the report shell test so the rendered page is expected to include cluster-specific UI such as `fraud cluster`, `safe cluster`, and a legend/summary line.

**Step 2: Run test to verify it fails**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: the new UI assertion fails because the current report page does not expose those labels.

**Step 3: Write minimal implementation**
- Update the embedding card to draw the larger point cloud with separate visual styles for each cluster.
- Add a compact legend and explanatory copy that describes relative distance from fraud and safe clusters.
- Keep the rest of the report layout unchanged.

**Step 4: Run tests to verify they pass**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: all tests pass.

### Task 3: Verify build and rendered output

**Files:**
- Modify: none unless failures require fixes

**Step 1: Build the report page**
Run: `pnpm --dir apps/frontend/report-page build`
Expected: successful production build.

**Step 2: Rebuild the frontend container**
Run: `docker compose up -d --build frontend`
Expected: frontend container rebuilds and serves the updated `/report/` app.

**Step 3: Verify rendered page**
- Create or reuse a scan id.
- Open `http://localhost:3000/report/#/report/<scan_id>`.
- Confirm the embedding card now shows many synthetic points and visible fraud/safe cluster separation.
