# Architecture

## 전체 구성

Safe Ticket은 거래 화면에서 사기 위험 신호를 읽고, backend 분석 결과를 extension과 report page에 다시 보여주는 구조다.

```text
Chrome Extension / Demo Pages
          │
          ▼
      FastAPI Backend
          │
   ┌──────┴──────────────┐
   ▼                     ▼
PostgreSQL + pgvector   External Lookup
   ▲                     │
   │                     ▼
Data Pipeline        Police / TheCheat
          │
          ▼
     RAG / LLM 설명
```

## 구성 요소

### Chrome Extension
- 실제 상품 페이지와 demo chat page에서 동작한다.
- 제목, 가격, 판매자, 본문, 계좌/전화번호 후보를 파싱한다.
- scan 생성과 결과 polling을 담당한다.
- 위험 문구를 DOM에 하이라이트한다.
- dashboard/report page로 이동하는 버튼을 제공한다.

### Report Page
- 특정 `scan_id` 기준 상세 분석 화면이다.
- dashboard, narrative report, settings view로 구성된다.
- backend risk-map 좌표를 사용해 embedding/risk space 시각화를 보여준다.
- scan이 없으면 임의 결과를 만들지 않고 scan 실행 안내를 보여준다.

### Backend API
- scan lifecycle을 관리한다.
- rule-based signal, external lookup, RAG retrieval, LLM 설명 생성, score 계산을 조합한다.
- 결과는 `GET /api/v1/scans/{scan_id}` 로 extension과 report page가 함께 사용한다.

### Database
- PostgreSQL + pgvector를 사용한다.
- scan result, case metadata, chunk embedding, feedback, lookup result 저장에 사용한다.

### Pipeline
- raw post 수집, 정제, chunking, embedding 생성, DB 적재를 담당한다.
- report page의 유사 사례 검색과 risk-map 시각화의 기반 데이터를 만든다.

## 온라인 분석 흐름
1. 사용자가 거래 페이지를 연다.
2. Extension이 페이지를 파싱한다.
3. `POST /api/v1/scans` 로 scan을 생성한다.
4. Backend가 background task에서 분석한다.
5. Extension은 `GET /api/v1/scans/{scan_id}` 를 polling 한다.
6. 완료 결과가 오면 panel, highlight, external lookup card, report link를 갱신한다.
7. 사용자는 report page에서 더 자세한 설명과 시각화를 확인한다.

## 분석 구성
- deterministic scoring
  - 외부조회 positive
  - PLS 기반 risk score
  - prototype / neighbor similarity
  - 적금계좌 rule
  - 사용자 맥락 가산점
- RAG context
  - 현재 게시글
  - 유사 사례 top-k
  - rule 결과
  - 외부조회 결과
  - 사용자 맥락
- LLM
  - report 문장 생성
  - 하이라이트 후보 생성
  - chatbot 답변 보조

## 운영 메모
- 로컬 개발과 서버 배포는 API/Frontend base URL을 build-time env로 분리한다.
- DB volume은 삭제하지 않는다.
- TheCheat 조회는 사용자가 noVNC browser에서 로그인/OTP를 한 뒤 backend가 같은 browser session을 재사용한다.
