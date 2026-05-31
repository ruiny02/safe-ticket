# Docker

이 문서는 로컬에서 Safe Ticket의 backend, pipeline, PostgreSQL을 함께 실행하는 방법을 설명합니다.

## Services

- `db`: PostgreSQL 16 + pgvector
- `pipeline`: FastAPI pipeline API on port `8010`
- `backend`: FastAPI backend API on port `8000`
- `frontend`: placeholder frontend container

## Run

```bash
cp .env.example .env
docker compose up --build
```

Backend container startup flow:

```text
wait for db
wait for pipeline health
run alembic upgrade head
start uvicorn backend server
```

Pipeline container startup flow:

```text
install pipeline requirements
start uvicorn main:app on port 8010
```

## Health Checks

Backend:

```text
http://localhost:8000/api/v1/health/live
http://localhost:8000/api/v1/health/ready
http://localhost:8000/api/v1/health/pipeline
```

Pipeline:

```text
http://localhost:8010/health
http://localhost:8010/docs
```

The backend should return:

```json
{
  "status": "ok",
  "pipeline_reachable": true
}
```

from:

```text
GET /api/v1/health/pipeline
```

## Smoke Test

After `docker compose up --build` is running, open a second terminal:

```bash
python scripts/smoke_backend_pipeline.py
```

The script verifies:

- backend readiness
- backend-to-pipeline connectivity
- `POST /api/v1/scans`
- `GET /api/v1/scans/{scan_id}`
- completed scan result from the pipeline

## Useful Commands

Rebuild only backend and pipeline:

```bash
docker compose build backend pipeline
docker compose up backend pipeline
```

View backend logs:

```bash
docker compose logs -f backend
```

View pipeline logs:

```bash
docker compose logs -f pipeline
```

Reset PostgreSQL data:

```bash
docker compose down -v
docker compose up --build
```
