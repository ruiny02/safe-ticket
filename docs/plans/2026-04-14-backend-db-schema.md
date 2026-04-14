# Backend DB Schema Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real PostgreSQL schema foundation for the backend using SQLAlchemy models and Alembic migrations, based on `docs/backend/db.md`.

**Architecture:** Keep the current API/service flow intact and add the database layer as a first-class persistence foundation rather than replacing the in-memory repository in the same milestone. Define SQLAlchemy metadata under `apps/backend/app/db`, wire Alembic under `apps/backend/migrations`, and create one initial migration that provisions the `vector` extension plus the documented tables.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Alembic, PostgreSQL 16, pgvector, psycopg 3

---

### Task 1: Add failing schema tests

**Files:**
- Create: `apps/backend/tests/test_db_schema.py`

**Step 1: Write the failing test**

Add tests that expect:
- `app.db.models` to exist
- `Base.metadata.tables` to contain:
  - `cases`
  - `case_chunks`
  - `case_entities`
  - `scans`
  - `scan_blocks`
  - `scan_evidence_items`
  - `scan_similar_cases`
  - `feedback`
  - `seller_observations`
- `case_chunks.embedding` to use `pgvector.sqlalchemy.VECTOR`
- child tables to contain the expected foreign keys to parent tables

**Step 2: Run test to verify it fails**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
PYTHONPATH=apps/backend . .venv/bin/activate && pytest apps/backend/tests/test_db_schema.py -q
```

Expected: FAIL because `app.db` does not exist yet.

**Step 3: Commit**

```bash
git add apps/backend/tests/test_db_schema.py
git commit -m "test: add failing backend db schema tests"
```

### Task 2: Add backend DB metadata and models

**Files:**
- Create: `apps/backend/app/db/__init__.py`
- Create: `apps/backend/app/db/base.py`
- Create: `apps/backend/app/db/models.py`
- Create: `apps/backend/app/db/session.py`
- Modify: `apps/backend/app/core/config.py`

**Step 1: Write minimal implementation**

Add:
- a shared SQLAlchemy `Base` with metadata naming conventions
- `Settings.database_url` sourced from `DATABASE_URL`
- `create_engine` / `sessionmaker` helpers in `session.py`
- ORM models for all tables documented in `docs/backend/db.md`

Design choices:
- use `str` business IDs for `case_id` and `scan_id`
- use numeric surrogate keys for internal child rows
- use `VECTOR()` for `case_chunks.embedding`
- default timestamps with `now()`
- foreign keys with `ondelete="CASCADE"` for child records

**Step 2: Run schema test to verify it passes**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
PYTHONPATH=apps/backend . .venv/bin/activate && pytest apps/backend/tests/test_db_schema.py -q
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/backend/app/db apps/backend/app/core/config.py apps/backend/tests/test_db_schema.py
git commit -m "feat: add backend sqlachemy schema metadata"
```

### Task 3: Initialize Alembic for the backend service

**Files:**
- Create: `apps/backend/alembic.ini`
- Create: `apps/backend/migrations/env.py`
- Create: `apps/backend/migrations/script.py.mako`
- Create: `apps/backend/migrations/README`
- Create: `apps/backend/migrations/versions/.gitkeep` or first revision file

**Step 1: Configure Alembic**

Set up Alembic so it:
- resolves imports from `apps/backend`
- reads the database URL from env or app settings
- targets `app.db.base.Base.metadata`

**Step 2: Smoke test Alembic wiring**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
PYTHONPATH=apps/backend . .venv/bin/activate && alembic -c apps/backend/alembic.ini current
```

Expected: command runs without import/config errors

**Step 3: Commit**

```bash
git add apps/backend/alembic.ini apps/backend/migrations
git commit -m "feat: initialize alembic for backend service"
```

### Task 4: Create the initial migration

**Files:**
- Create: `apps/backend/migrations/versions/<revision>_initial_schema.py`

**Step 1: Generate or write the initial migration**

The migration must:
- `CREATE EXTENSION IF NOT EXISTS vector`
- create all documented tables
- create core indexes / unique constraints:
  - `case_chunks(case_id, chunk_order)` unique
  - `scan_blocks(scan_id, block_id)` unique
  - `scan_similar_cases(scan_id, rank)` unique
  - lookup indexes on `seller_observations.account_hash`, `phone_hash`, `messenger_hash`
  - useful indexes on `scans.status`, `scans.created_at`

**Step 2: Apply migration to the running Docker Postgres**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5433/safe_ticket \
PYTHONPATH=apps/backend . .venv/bin/activate && \
alembic -c apps/backend/alembic.ini upgrade head
```

Expected: upgrade succeeds

**Step 3: Verify schema directly in PostgreSQL**

Run:

```bash
docker exec -it safe-ticket-db psql -U postgres -d safe_ticket -c "\\dt"
```

Expected: all initial tables exist

**Step 4: Commit**

```bash
git add apps/backend/migrations/versions
git commit -m "feat: add initial backend database migration"
```

### Task 5: Add migration verification tests and docs updates

**Files:**
- Modify: `docs/backend/db.md`
- Optionally create: `apps/backend/tests/test_alembic_smoke.py`

**Step 1: Document the real commands**

Update `docs/backend/db.md` with:
- where Alembic files live
- how to run `upgrade head`
- how to verify current revision
- that local Docker DB data is not shared via Git

**Step 2: Verify end-to-end**

Run:

```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
PYTHONPATH=apps/backend . .venv/bin/activate && pytest apps/backend/tests/test_db_schema.py -q
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5433/safe_ticket \
PYTHONPATH=apps/backend . .venv/bin/activate && alembic -c apps/backend/alembic.ini current
docker exec safe-ticket-db psql -U postgres -d safe_ticket -c "\\d scans"
```

Expected:
- schema tests pass
- Alembic reports the head revision
- `scans` table exists with expected columns

**Step 3: Commit**

```bash
git add docs/backend/db.md apps/backend/tests
git commit -m "docs: document backend db migration workflow"
```
