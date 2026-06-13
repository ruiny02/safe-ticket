# Docker

Safe Ticket 로컬 개발은 Docker Compose 기준으로 실행한다.

## Services
- `db`: PostgreSQL 16 + pgvector
- `backend`: FastAPI backend API, 기본 `8000`
- `frontend`: demo pages + report page server, 기본 `3000`
- `pipeline`: pipeline API, 기본 `8010`
- `lookup-browser`: Playwright Chromium + noVNC, 기본 `6080`

## Run

```bash
cp .env.example .env
DB_PORT=5433 docker compose up --build
```

`5432`가 비어 있으면 `DB_PORT=5433` 없이 실행해도 된다.

## URLs
- Demo product: `http://localhost:3000/product/227242032.html`
- Joongna chat demo: `http://localhost:3000/joongna-chat.html`
- Bunjang chat demo: `http://localhost:3000/bunjang-chat.html`
- Report page: `http://localhost:3000/report/`
- Backend health: `http://localhost:8000/api/v1/health/live`
- Backend docs: `http://localhost:8000/docs`
- noVNC lookup browser: `http://localhost:6080/vnc.html`

## Notes
- `docker compose down -v` 는 DB와 lookup browser profile volume을 삭제한다.
- 발표/검증 중에는 volume 삭제 명령을 사용하지 않는다.
- Extension build는 Compose와 별도로 실행한다.

```bash
pnpm --dir apps/frontend/extension build
```
