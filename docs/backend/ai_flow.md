# AI / RAG Flow

## 목표
- 현재 게시글의 위험 점수를 deterministic하게 계산한다.
- 가까운 과거 사례를 검색해 RAG context를 만든다.
- LLM은 점수를 직접 만들지 않고, 설명과 하이라이트 후보 생성에 사용한다.

## Scan 처리 흐름
1. 입력 normalize
2. 계좌번호 / 전화번호 / 위험 문구 후보 추출
3. 경찰청 / 더치트 외부조회
4. 적금계좌 rule 탐지
5. 현재 게시글 embedding 생성
6. DB의 `case_chunks.embedding` 과 유사 사례 검색
7. risk score 계산
   - 외부조회 positive는 high로 강제
   - PLS 기반 risk score
   - PLS latent space 기반 prototype / neighbor score
   - 적금계좌 rule 가산점
   - 사용자 맥락 가산점
8. RAG context 생성
9. LLM report/highlight 생성
10. backend span validation
11. `ScanResultResponse` 저장

## RAG context
RAG context는 여러 LLM 호출에서 재사용 가능한 공통 입력이다.

- 현재 게시글 텍스트
- rule 결과
- 외부조회 결과
- top-k 유사 사례
- 사용자 맥락
- score breakdown

## LLM 실패 처리
- Gemini/API 호출 실패 시 scan 전체를 실패시키지 않는다.
- deterministic score, rule 결과, 유사 사례 결과는 유지한다.
- 설명 문구는 fallback summary로 대체하고 `degraded=true` 를 표시한다.

## 시각화용 데이터
- risk-map endpoint는 DB embedding과 현재 scan embedding을 backend에서 투영한다.
- frontend는 backend 좌표를 그대로 렌더링하며 임의 좌표를 만들지 않는다.
