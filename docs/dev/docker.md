# Docker

## 현재 목적
- 코드가 완성되기 전에 **컨테이너 구성과 네트워크 연결 구조를 먼저 고정**한다.
- `db / backend / frontend / pipeline` 4개 서비스를 같은 compose 파일에서 올릴 수 있게 한다.

## 현재 상태
- `db`: 실제 PostgreSQL + pgvector 컨테이너
- `backend`: placeholder Python HTTP 서버
- `frontend`: placeholder Nginx 정적 페이지
- `pipeline`: placeholder Python HTTP 서버

## 왜 placeholder 인가
현재 단계에서는 실제 FastAPI / React / 파이프라인 코드보다 **문서와 실행 구조 정리**가 우선이기 때문이다.
실제 앱 코드를 넣으면 각 Dockerfile 의 실행 명령만 바꾸면 된다.

## Docker 이미지 파일
- `docker/backend.Dockerfile`
- `docker/frontend.Dockerfile`
- `docker/pipeline.Dockerfile`
- `docker/db/init/01-enable-pgvector.sql`

## 실행 순서
```bash
cp .env.example .env

docker compose up --build
```

## 향후 바뀌는 부분
- backend: `python -m http.server` -> `uvicorn app.main:app`
- frontend: placeholder nginx -> React build/dev server
- pipeline: placeholder server -> 실제 수집 / 적재 runner
