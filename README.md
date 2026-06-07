# Safe Ticket

Safe Ticket detects fraud risk signals in ticket resale and secondhand marketplace posts, then provides explainable evidence and response guidance through a Chrome Extension, FastAPI backend, PostgreSQL/pgvector storage, and an AI/RAG-oriented data pipeline.

## Run the Current MVP on `main`

### 1. Prepare `.env`

From the project root:

```bash
cp .env.example .env
```

Minimum values to check:

- `BACKEND_PORT=8000`
- `FRONTEND_PORT=3000`
- `DB_PORT=5432`
- `BACKEND_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,chrome-extension://YOUR_EXTENSION_ID`

Notes:

- If a local PostgreSQL instance already uses port `5432`, run Docker Compose with `DB_PORT=5433`.
- After loading the Chrome Extension once, check its extension ID in Chrome and add `chrome-extension://<EXTENSION_ID>` to `BACKEND_CORS_ORIGINS`.

### 2. Start Docker

If the default ports are available:

```bash
docker compose up --build
```

If the local DB port conflicts:

```bash
DB_PORT=5433 docker compose up --build
```

After startup, open:

- Product demo page: `http://localhost:3000/product/227242032.html`
- Joonggonara chat demo: `http://localhost:3000/joongna-chat.html`
- Bungaejangter chat demo: `http://localhost:3000/bunjang-chat.html`
- Report page: `http://localhost:3000/report/`
- Backend live health: `http://localhost:8000/api/v1/health/live`
- Backend ready health: `http://localhost:8000/api/v1/health/ready`
- TheCheat login browser: `http://localhost:6080`

### 2-1. Use TheCheat Lookups

TheCheat requires OTP login, so Safe Ticket does not automate login. Instead, the backend reuses the browser session that you log into manually inside Docker.

1. Open `http://localhost:6080`.
   - If you see a directory listing, click `vnc.html` or open `http://localhost:6080/vnc.html` directly.
2. Click `Connect` in noVNC.
3. Log into TheCheat and complete OTP verification in the opened Chromium browser.
4. Backend requests to `POST /api/v1/external-lookups` can then reuse that logged-in browser session.

Notes:

- Running `docker compose down -v` removes the saved browser profile volume, so you will need to log in again.
- If you change `LOOKUP_BROWSER_PORT`, update both `.env` and the browser URL.

### 3. Build the Chrome Extension

In a new terminal:

```bash
pnpm --dir apps/frontend/web-demo build
```

Build output:

- `apps/frontend/web-demo/dist`

### 4. Load the Extension in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select `apps/frontend/web-demo/dist`.

If the extension is already loaded, rebuild the extension and click `Reload` in `chrome://extensions`; you do not need to remove and reinstall it.

### 5. Verify the MVP

1. Open `http://localhost:3000/product/227242032.html` or `http://localhost:3000/joongna-chat.html`.
2. Click `Run scan` in the Safe Ticket extension panel.
3. Confirm that the page shows a risk summary, suspicious evidence, recommended actions, and red text highlights.

### 6. View Backend Logs

```bash
docker compose logs -f backend
```

When the scan flow works correctly, you should see requests such as `POST /api/v1/scans` and `GET /api/v1/scans/{scan_id}`.

## Project Overview

- The Chrome Extension reads marketplace listing or chat content and sends parsed transaction data to the backend.
- The FastAPI backend manages scan requests, stores scan state, calls the AI pipeline, runs external lookup flows, retrieves similar fraud cases, and returns frontend-ready results.
- The data pipeline collects marketplace posts, preprocesses fraud-related text, builds RAG memory records, and prepares embedding data for semantic retrieval.
- Users receive fraud warnings, evidence highlights, similar case references, and recommended actions directly on the current page or report dashboard.

## Service Components

- `apps/backend`: FastAPI backend, scan lifecycle, DB persistence, external lookup, case retrieval, and chat APIs.
- `apps/frontend`: Chrome Extension, demo marketplace pages, chat demos, shared frontend utilities, and report dashboard.
- `apps/pipeline`: Crawling, preprocessing, raw post upload, fraud memory export, embedding generation, and pipeline API.
- `docs`: Role-specific and workflow documentation.
- `docker-compose.yml`: Local integrated runtime for DB, backend, frontend, lookup browser, and pipeline services.

## Architecture

```text
Chrome Extension / Web
          │
          ▼
      FastAPI API
          │
   ┌──────┴────────┐
   ▼               ▼
PostgreSQL     AI / RAG Flow
  + pgvector   (Rules + Retrieval + LLM)
          ▲
          │
     Data Pipeline
```

## Documentation

- `docs/common`: Project scope and architecture.
- `docs/backend`: API, database, and AI processing flow.
- `docs/frontend`: Web and Chrome Extension structure.
- `docs/pipeline`: Crawling sources and data pipeline.
- `docs/dev`: Docker, deployment, and branch strategy.

## Branch Strategy

- `main`
- `develop`
- `feature/*`
- `fix/*`
- `docs/*`
