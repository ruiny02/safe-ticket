# Safe Ticket

암표 / 중고 거래 게시글의 사기 위험 신호를 탐지하고, 근거와 대응 가이드를 함께 제공하는 프로젝트입니다.

## 프로젝트 소개
- 크롬 확장 프로그램에서 거래 게시글을 읽고 백엔드에 분석을 요청합니다.
- 백엔드는 규칙 기반 탐지, pgvector 기반 유사 사례 검색, LLM 설명 생성을 조합해 결과를 만듭니다.
- 사용자는 현재 페이지에서 위험 경고를 보고, 상세 리포트는 웹페이지에서 확인합니다.

## 빠른 시작 (Quick Start)
```bash
cp .env.example .env

docker compose up --build
```

> 현재 단계의 Docker 구성은 **서비스 wiring 확인용 placeholder**입니다.
> 실제 FastAPI / React 앱 코드는 이후에 추가합니다.

## 서비스 구성
- `apps/backend`: FastAPI 백엔드 예정
- `apps/frontend`: 웹 리포트 페이지 / 확장 프로그램 UI 예정
- `apps/pipeline`: 크롤링 / 정제 / 적재 파이프라인 예정
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

## 실행 방법
```bash
# DB + placeholder backend/frontend/pipeline 컨테이너 기동

docker compose up --build
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
