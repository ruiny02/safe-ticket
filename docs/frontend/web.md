# Web Report Page

## 역할
Report page는 extension의 짧은 경고를 상세 분석 화면으로 확장한다. scan result를 기준으로 위험 점수, 근거, 유사 사례, 외부조회 결과, 임베딩 시각화를 보여준다.

## 주요 화면
- `/#/dashboard?scanId=<scan_id>`
  - 현재 scan 기준 dashboard
  - 위험 점수와 핵심 신호
  - 외부조회 결과
  - 판매자 관찰 정보
  - embedding / risk-map 시각화
- `/#/reports/<scan_id>`
  - 문장형 report
  - 판단 요약, 문제 핵심, 권장 대응
  - 유사 사례와 현재 게시글의 연결 설명
- `/#/settings`
  - 로그인 없는 사용자 정보 설정
  - 나이와 중고거래 경험만 저장
  - 입력값은 맞춤형 위험도 계산에 사용

## Scan이 없을 때
Report page는 임의 좌표나 샘플 결과를 보여주지 않는다. `scan_id`가 없거나 backend에서 결과를 찾지 못하면 extension에서 먼저 scan을 실행하라는 안내를 보여준다.

## 시각화
- Backend risk-map API 결과만 사용한다.
- 임의 demo embedding fallback은 사용하지 않는다.
- 현재 scan은 보라색 star marker로 표시한다.
- 위치는 위험 확률 자체가 아니라 risk-aware embedding 구조의 상대적 위치로 해석한다.

## API
- `GET /api/v1/scans/{scan_id}`
- `GET /api/v1/scans/{scan_id}/pipeline-debug`
- `GET /api/v1/cases/risk-map`
- `POST /api/v1/scans/{scan_id}/feedback`
