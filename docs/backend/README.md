# Backend Docs

## 역할
- 스캔 API 제공
- 상태 저장 및 조회
- pgvector 기반 사례 검색
- LLM 설명 생성 연결
- 피드백 저장

## 현재 핵심 결정
- 스캔 API는 **동기식 단일 응답**이 아니라 **비동기 + polling** 방식으로 간다.
- 초기 단계에서는 모든 API를 **인증 없이 public** 으로 둔다.
- PostgreSQL 연결은 **SQLAlchemy + psycopg (v3)** 기준으로 정리한다.
- 검색은 pgvector를 중심으로 하고, LangChain 대신 **LangGraph 기반 파이프라인**으로 정리한다.

## 문서 목록
- `api.md`: 엔드포인트, 비동기 처리, CORS, 에러 정책
- `db.md`: 테이블, 인덱스, pgvector 구조
- `ai_flow.md`: 규칙 탐지, retrieval, LLM 설명 생성 흐름
