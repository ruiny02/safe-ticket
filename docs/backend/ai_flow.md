# AI Flow

## 목표
- 게시글을 분석해 위험 점수와 근거를 만든다.
- 과거 사례와의 유사성을 검색한다.
- 사람이 읽을 수 있는 설명을 생성한다.
- LLM 실패 시에도 최소 결과를 남긴다.

## 현재 설계 원칙
- LangChain 대신 **LangGraph** 를 중심으로 상태 기반 파이프라인을 설계한다.
- 규칙 기반 탐지는 1차 구현에서 사용한다.
- 사례 검색은 **pgvector 기반 RAG** 를 기본으로 한다.
- 설명 생성은 OpenAI API를 우선 사용한다.

## 입력
- `platform`
- `page_url`
- `page_title`
- `price`
- `seller`
- `content_blocks`

## LangGraph 기준 처리 단계

### 1. Normalize
- content block을 분석용 입력으로 정리
- 공백 / 줄바꿈 / 기본 잡음 처리

### 2. Entity Extraction
- 전화번호
- 계좌번호
- 메신저 ID
- 공연명 / 상품명 / 좌석 / 가격 등

### 3. Rule-based Detection
초기 단계에서 아래와 같은 명시적 위험 신호를 먼저 잡는다.
- 안전거래 회피
- 외부 메신저 이동 유도
- 선입금 유도
- 급매 / 시간 압박 표현
- 과도하게 낮은 가격

### 4. Retrieval
- 게시글 입력을 임베딩한다.
- pgvector 에 저장된 `case_chunks.embedding` 과 비교한다.
- top-k 유사 사례를 검색한다.
- exact match 가능한 엔티티(계좌 / 전화 / 메신저)는 별도 신호로 합친다.

### 5. LLM Reasoning
- 규칙 탐지 결과 + retrieval 결과를 묶어 설명을 생성한다.
- 결과는 사람이 읽을 문장과 UI가 바로 쓸 구조적 필드를 함께 만든다.

### 6. Output Assembly
최종 출력에는 아래가 포함된다.
- `risk_level`
- `risk_score`
- `summary`
- `risk_tags`
- `evidence_items`
- `similar_cases`
- `recommended_actions`

## LLM 실패 시 fallback
- LLM timeout / rate limit / provider error 시 `partial` 결과 허용
- 규칙 탐지 결과와 retrieval 결과만으로 최소 요약 생성
- `degraded=true` 표시

## 시각화용 데이터
웹 리포트 페이지의 UMAP 2D 시각화를 위해 다음 정보를 남긴다.
- 현재 스캔 벡터
- top-k 유사 사례 벡터
- 추가 비교 샘플 벡터
- nearest neighbor 관계 정보

## 메모
- 초기에는 파이프라인을 직렬적으로 단순하게 유지한다.
- 데이터가 커지면 retrieval / reranking / worker 분리를 다시 검토한다.
- 장기적으로는 OpenAI provider 뒤를 다른 provider로 교체할 수 있도록 인터페이스를 분리한다.
