# Unified Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge the product-page extension and trade-chat demo extension into one `apps/frontend/web-demo` Chrome extension.

**Architecture:** Keep `web-demo` as the only extension build target and reuse its purple side-panel theme. Port trade-chat parsing, local chat risk rules, and the AI-chat placeholder into typed frontend modules, while keeping `trade-chat-demo` as static demo pages only.

**Tech Stack:** React, TypeScript, Vite, Vitest, Chrome MV3 content scripts.

---

### Task 1: Page Target Support

**Files:**
- Modify: `apps/frontend/shared/page-target.ts`
- Modify: `apps/frontend/web-demo/src/main.tsx`
- Test: `apps/frontend/web-demo/src/lib/__tests__/extension.test.ts`

**Steps:**
1. Add failing tests for local trade-chat pages and unrelated localhost pages.
2. Add unified page-target helpers that recognize Joongna product pages and chat demo pages.
3. Update the content-script entrypoint to mount on the unified supported page set.
4. Run `pnpm --dir apps/frontend/web-demo test`.

### Task 2: Chat Parser Port

**Files:**
- Create: `apps/frontend/shared/trade-chat.ts`
- Modify: `apps/frontend/shared/types.ts`
- Test: `apps/frontend/web-demo/src/lib/__tests__/trade-chat.test.ts`

**Steps:**
1. Add failing tests for parsing a chat demo document into a `ScanCreateRequest`.
2. Port the trade-chat parser from plain JavaScript to TypeScript.
3. Widen `ScanCreateRequest.platform` so chat demo platforms can be submitted.
4. Run the parser test.

### Task 3: Local Chat Risk Rules

**Files:**
- Create: `apps/frontend/web-demo/src/lib/chat-rules.ts`
- Test: `apps/frontend/web-demo/src/lib/__tests__/chat-rules.test.ts`

**Steps:**
1. Add failing tests for local chat highlight rules and deduped backend/local merge.
2. Port the chat demo rules into reusable TypeScript helpers.
3. Run the chat-rules test.

### Task 4: Unified Panel UI

**Files:**
- Modify: `apps/frontend/web-demo/src/App.tsx`
- Modify: `apps/frontend/web-demo/src/styles.css`
- Modify: `apps/frontend/web-demo/src/lib/panel-content.ts`

**Steps:**
1. Make `App` choose product parsing or chat parsing based on the current page.
2. Apply merged highlight targets for chat pages.
3. Add a compact AI-chat placeholder section using the web-demo visual theme.
4. Keep existing external lookup, report, and dashboard links.

### Task 5: Extension Packaging Cleanup

**Files:**
- Modify: `apps/frontend/web-demo/public/manifest.json`
- Modify: `apps/frontend/web-demo/public/popup.js`
- Delete or deprecate: `apps/frontend/trade-chat-demo/manifest.json`
- Modify: `apps/frontend/trade-chat-demo/README.md`

**Steps:**
1. Update MV3 matches so the unified extension can run on product and chat demo pages.
2. Update popup status copy and latest-report link handling.
3. Remove the separate trade-chat extension load target to prevent two-extension confusion.
4. Run `pnpm --dir apps/frontend/web-demo build`.

### Task 6: Panel Tabs for AI Chat

**Files:**
- Modify: `apps/frontend/web-demo/src/App.tsx`
- Modify: `apps/frontend/web-demo/src/styles.css`

**Steps:**
1. Add `분석` / `AI 질문` tabs to the unified side panel.
2. Keep existing risk summary and report actions always visible.
3. Move external lookup, current page, signals, and actions into the `분석` tab.
4. Move the chat UI into the `AI 질문` tab and give it a taller log area.
5. Run `pnpm --dir apps/frontend/web-demo test` and `pnpm --dir apps/frontend/web-demo build`.
