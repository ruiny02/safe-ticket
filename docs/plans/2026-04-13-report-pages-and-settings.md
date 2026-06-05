# Report Pages And Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the current report page into Dashboard, Reports, and Settings views, and add a demo account/login experience in Settings.

**Architecture:** Keep the existing report-page app and bright dashboard theme, but add lightweight hash-based navigation so the sidebar can switch between Dashboard, Reports, and Settings without introducing a larger routing dependency. Reuse the existing scan/pipeline fetch logic for Reports, create dashboard summary cards from current scan state, and keep Settings as a demo-only account/preferences screen backed by local component state.

**Tech Stack:** React, TypeScript, Vitest, Vite

---

### Task 1: Lock navigation shell expectations

**Files:**
- Modify: `apps/frontend/report-page/src/__tests__/app-shell.test.tsx`
- Modify: `apps/frontend/report-page/src/App.tsx`

**Step 1: Write the failing test**
- Extend the shell test to expect `Dashboard`, `Reports`, and `Settings` sidebar entries.
- Expect `Dashboard`-specific summary content to render by default.

**Step 2: Run test to verify it fails**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: FAIL because the current shell does not render those navigation items or dashboard copy.

**Step 3: Write minimal implementation**
- Add view parsing from the hash.
- Render sidebar navigation entries and a default dashboard view.

**Step 4: Run tests to verify they pass**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: PASS.

### Task 2: Add Dashboard and Reports split

**Files:**
- Modify: `apps/frontend/report-page/src/App.tsx`
- Modify: `apps/frontend/report-page/src/styles.css`
- Modify: `apps/frontend/report-page/src/lib/dashboard-model.ts`

**Step 1: Write the failing test**
- Add assertions that the Dashboard view shows summary/statistics content.
- Add assertions that the Reports view keeps the detailed scan analysis content.

**Step 2: Run test to verify it fails**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: FAIL because the views are not separated yet.

**Step 3: Write minimal implementation**
- Create a dashboard-first landing section with recent scan summary, risk distribution, and visualization blocks.
- Move detailed scan analysis into the Reports view while preserving the existing fetch logic.

**Step 4: Run tests to verify they pass**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: PASS.

### Task 3: Add Settings account/login demo view

**Files:**
- Modify: `apps/frontend/report-page/src/App.tsx`
- Modify: `apps/frontend/report-page/src/styles.css`

**Step 1: Write the failing test**
- Add assertions that Settings renders account/login content such as `로그인`, `계정 상태`, or similar.

**Step 2: Run test to verify it fails**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: FAIL because Settings has no account UI yet.

**Step 3: Write minimal implementation**
- Add a demo settings page with account status, login form fields, notification/sensitivity preferences, and a signed-in summary card.
- Keep it local-state only; no backend auth integration in this task.

**Step 4: Run tests to verify they pass**
Run: `pnpm --dir apps/frontend/report-page test`
Expected: PASS.

### Task 4: Build and verify the report app

**Files:**
- Modify: none unless fixes are required

**Step 1: Build the app**
Run: `pnpm --dir apps/frontend/report-page build`
Expected: successful production build.

**Step 2: Rebuild frontend container**
Run: `docker compose up -d --build frontend`
Expected: frontend serves the updated `/report/` app.

**Step 3: Verify views manually**
- Open `http://localhost:3000/report/`
- Confirm Dashboard is default.
- Open `#/reports/<scan_id>` and confirm detailed report still works.
- Open `#/settings` and confirm account/login cards render.
