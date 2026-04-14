# DB

## 기본 결정
- DBMS: PostgreSQL
- 벡터 검색: pgvector
- SQLAlchemy 연결 문자열은 **`postgresql+psycopg://...`** 기준으로 정리한다.
- 드라이버는 `psycopg` (v3)를 사용한다.

## 저장해야 하는 대상
- 수집한 사례 원문
- 사례 chunk 및 임베딩
- 스캔 요청과 결과
- 하이라이트 근거
- 유사 사례 매핑
- 사용자 피드백
- 판매자 관련 관찰 이력

## 주요 테이블

### `cases`
수집한 사기 사례 문서 원문
- `case_id`
- `source_type`
- `source_url`
- `title`
- `body`
- `label`
- `summary`
- `platform_hint`
- `created_at`

### `case_chunks`
검색용 chunk 및 임베딩 저장
- `chunk_id`
- `case_id`
- `chunk_text`
- `chunk_order`
- `embedding`
- `created_at`

### `case_entities`
문서에서 추출한 주요 엔티티
- `id`
- `case_id`
- `entity_type`
- `entity_value_raw`
- `entity_value_hash`
- `created_at`

### `scans`
사용자 스캔 요청과 분석 상태 저장
- `scan_id`
- `platform`
- `page_url`
- `page_title`
- `price`
- `status`
- `risk_level`
- `risk_score`
- `summary`
- `llm_reasoning`
- `degraded`
- `created_at`
- `updated_at`

### `scan_blocks`
요청 시 들어온 content block 원문 저장
- `id`
- `scan_id`
- `block_id`
- `text`

### `scan_evidence_items`
하이라이트 대상 근거 저장
- `id`
- `scan_id`
- `block_id`
- `start_offset`
- `end_offset`
- `matched_text`
- `reason_code`
- `reason`
- `score`

### `scan_similar_cases`
유사 사례 결과 저장
- `id`
- `scan_id`
- `case_id`
- `chunk_id`
- `similarity_score`
- `rank`
- `summary`

### `feedback`
사용자 피드백 저장
- `id`
- `scan_id`
- `feedback_type`
- `comment`
- `created_at`

### `seller_observations`
판매자 관련 식별자 / 관찰 이력 저장
- `id`
- `platform`
- `seller_id`
- `nickname`
- `account_hash`
- `phone_hash`
- `messenger_hash`
- `source_ref`
- `created_at`

## 관계
- `cases` 1 : N `case_chunks`
- `cases` 1 : N `case_entities`
- `scans` 1 : N `scan_blocks`
- `scans` 1 : N `scan_evidence_items`
- `scans` 1 : N `scan_similar_cases`
- `scans` 1 : N `feedback`

## pgvector 사용 방식
- 각 `case_chunks` 행에 `embedding` vector 컬럼을 둔다.
- 현재 게시글을 임베딩한 뒤 `case_chunks.embedding` 과 거리 비교를 수행한다.
- 검색 결과는 `scan_similar_cases` 에 저장해 웹 리포트와 디버깅에 재사용한다.

## 검색 메모
- 초기에는 정확도 확인을 위해 **exact search** 로 시작한다.
- 데이터가 늘어나면 HNSW / IVFFlat 인덱스를 검토한다.
- 현재 시각화용으로는 `top-k neighbor` 와 추가 샘플을 함께 가져와 2차원 투영 데이터로 사용할 수 있게 한다.

## 민감정보 메모
- 계좌, 전화번호, 메신저 ID 는 raw 값과 hash 전략을 분리해 설계한다.
- UI 노출이나 seller history 요약에는 raw 값 전체를 직접 쓰지 않고 masking / hash 활용을 기본으로 잡는다.

## Alembic 운영 메모
- Alembic 설정 파일: `apps/backend/alembic.ini`
- migration 디렉토리: `apps/backend/migrations`
- SQLAlchemy metadata: `apps/backend/app/db/models.py`

### 현재 초기 revision
- head revision: `63da3c25624b`
- 목적: `vector` extension 생성 + 초기 핵심 테이블 생성

### 로컬 Docker Postgres에 반영
```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
source .venv/bin/activate
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5433/safe_ticket \
PYTHONPATH=apps/backend \
alembic -c apps/backend/alembic.ini upgrade head
```

### 현재 revision 확인
```bash
cd /home/taeyeong/lectures/CDP_ws/safe-ticket
source .venv/bin/activate
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5433/safe_ticket \
PYTHONPATH=apps/backend \
alembic -c apps/backend/alembic.ini current
```

### DB 직접 확인
```bash
docker exec safe-ticket-db psql -U postgres -d safe_ticket -c "\\dt"
docker exec safe-ticket-db psql -U postgres -d safe_ticket -c "\\d scans"
```

## 협업 메모
- Git에는 실제 DB 데이터가 아니라 migration 파일과 모델 코드만 올라간다.
- 로컬 Docker DB 안의 실제 테이블 상태와 데이터는 각 개발자 환경에 따로 존재한다.
- 협업 시에는 `alembic upgrade head` 로 schema를 맞추고, 공통 개발 데이터가 필요하면 seed / fixture 로 공유한다.
