# Safe Ticket

## 현재 main에 있는 MVP 일단은 실행하기

### 1. `.env` 준비
프로젝트 루트에서:

```bash
cp .env.example .env
```

최소 확인 항목:
- `BACKEND_PORT=8000`
- `FRONTEND_PORT=3000`
- `DB_PORT=5432`
- `BACKEND_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,chrome-extension://YOUR_EXTENSION_ID`

주의:
- 로컬 PostgreSQL 이 이미 `5432` 를 쓰고 있으면 `DB_PORT=5433` 으로 바꿉니다.
- extension ID 는 Chrome 에 확장을 한 번 로드한 뒤 확인해서 `BACKEND_CORS_ORIGINS` 에 반영합니다.

### 2. Docker 실행
기본 포트를 그대로 쓸 수 있으면:

```bash
docker compose up --build
```

로컬 DB 포트 충돌이 있으면:

```bash
DB_PORT=5433 docker compose up --build
```

실행 후 접속 주소:
- 데모 페이지: `http://localhost:3000/product/227242032.html`
- 중고나라 채팅 데모: `http://localhost:3000/joongna-chat.html`
- 번개장터 채팅 데모: `http://localhost:3000/bunjang-chat.html`
- 백엔드 health: `http://localhost:8000/api/v1/health/live`
- 더치트 로그인 브라우저: `http://localhost:6080`

### 2-1. 더치트 조회를 사용할 때
더치트는 OTP 로그인이 필요하므로 자동 로그인을 하지 않습니다. Docker 안에 떠 있는 브라우저에 사용자가 직접 로그인하면, backend가 그 브라우저 세션을 재사용합니다.

1. `http://localhost:6080` 접속
   - 디렉터리 목록이 보이면 `vnc.html` 을 클릭하거나 `http://localhost:6080/vnc.html` 로 직접 접속합니다.
2. noVNC 화면에서 `Connect` 클릭
3. 열린 Chromium에서 더치트 로그인 및 OTP 인증 완료
4. 이후 backend의 `POST /api/v1/external-lookups` 더치트 조회가 해당 로그인 세션을 사용

주의:
- `docker compose down -v` 를 실행하면 더치트 브라우저 프로필 볼륨도 삭제되어 다시 로그인해야 합니다.
- `LOOKUP_BROWSER_PORT` 를 바꾸면 `.env` 와 접속 주소도 같이 맞춰야 합니다.

### 3. extension 빌드
새 터미널에서:

```bash
pnpm --dir apps/frontend/web-demo build
```

산출물 위치:
- `apps/frontend/web-demo/dist`

### 4. Chrome 에 extension 로드
1. `chrome://extensions` 접속
2. `개발자 모드` 활성화
3. `압축해제된 확장 프로그램을 로드합니다` 클릭
4. `apps/frontend/web-demo/dist` 선택

이미 로드한 상태에서 다시 빌드했으면 삭제 후 재설치할 필요는 없고 `Reload`만 하면 됩니다.

### 5. 동작 확인
1. `http://localhost:3000/product/227242032.html` 또는 `http://localhost:3000/joongna-chat.html` 열기
2. 우측 상단 확장 패널에서 `스캔 실행` 클릭
3. 위험 요약 / 문제 이유 / 권장 확인 사항 / 본문 빨간 하이라이트 확인

### 6. backend 로그 보기

```bash
docker compose logs -f backend
```

정상이면 `POST /api/v1/scans` 와 `GET /api/v1/scans/{scan_id}` 로그가 보입니다.

암표 / 중고 거래 게시글의 사기 위험 신호를 탐지하고, 근거와 대응 가이드를 함께 제공하는 프로젝트입니다.

## 프로젝트 소개
- 크롬 확장 프로그램에서 거래 게시글을 읽고 백엔드에 분석을 요청합니다.
- 백엔드는 현재 FastAPI 기반 MVP로 동작하며, 규칙 기반 탐지와 하이라이트용 근거 데이터를 반환합니다.
- 사용자는 현재 페이지에서 위험 경고와 하이라이트를 바로 확인할 수 있습니다.

## 서비스 구성
- `apps/backend`: FastAPI 백엔드
- `apps/frontend`: 크롬 확장 프로그램과 데모 페이지 자산
- `apps/pipeline`: 향후 파이프라인 확장 영역
- `docs`: 역할별 문서
- `docker-compose.yml`: 로컬 통합 실행용 구성

## 아키텍처 그림
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

## docs 안내
- `docs/common`: 프로젝트 범위와 전체 구조
- `docs/backend`: API, DB, AI 처리 흐름
- `docs/frontend`: 웹 / 크롬 익스텐션 구조
- `docs/pipeline`: 크롤링 소스와 데이터 파이프라인
- `docs/dev`: Docker / 브랜치 전략

## 브랜치 전략
- `main`
- `develop`
- `feature/*`
- `fix/*`
- `docs/*`
