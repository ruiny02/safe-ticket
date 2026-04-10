# Extension

## 역할
크롬 확장 프로그램은 사용자가 실제로 보고 있는 거래 페이지 위에서 **즉시 경고를 보여주고, 대화를 이어가며, 상세 분석 페이지로 연결하는 인터페이스**다.

## 방향 정리
- `scan panel`
  - 거래 페이지 위에 별도로 띄우는 분석 전용 패널
  - 스캔 요청, 위험 요약, 하이라이트, 권장 확인 사항을 담당
- `chat panel`
  - 기존 우측 패널을 대화형 인터페이스로 재구성한 패널
  - 사용자가 결과를 바탕으로 추가 질문을 던지는 역할을 담당
- `report page`
  - extension에서 클릭해서 이동하는 상세 분석 페이지
  - 긴 설명, 시각화, 사례 비교는 웹 페이지에서 담당

## 현재 MVP 구현
- `apps/frontend/web-demo` 는 이제 standalone 웹페이지가 아니라 **Manifest V3 content script 확장 프로그램**이다.
- 확장 프로그램은 `localhost` 데모 페이지와 실제 `web.joongna.com/product/*` 페이지를 대상으로 동작한다.
- 파싱과 API payload 생성은 `apps/frontend/shared` 아래 공용 로직을 그대로 사용한다.
- 현재 MVP 는 `scan panel` 기준으로 동작하고, `POST /api/v1/scans` 생성 후 `GET /api/v1/scans/{scan_id}` 결과를 polling 해서 표시한다.
- `chat panel` 과 `report page` 는 다음 단계에서 확장할 방향으로 문서상 역할을 먼저 고정한다.

## 주요 동작
- 허용한 사이트의 거래 게시글 페이지에서만 동작
- 제목 / 본문 / 가격 / 판매자 정보 / 엔티티 후보를 추출
- 백엔드에 스캔 작업 생성 요청
- 결과가 나올 때까지 polling
- 위험 문구 하이라이트
- 위험 요약 배지 / 메시지 표시
- 상세 분석 페이지 진입점 제공
- 대화형 패널로 확장 가능한 상태 구조 유지

## 백엔드 연동 흐름
1. 현재 페이지에서 `content_blocks` 추출
2. `POST /api/v1/scans` 호출
3. `scan_id` 수신
4. `GET /api/v1/scans/{scan_id}` polling
5. `completed` / `partial` 결과 수신
6. 하이라이트와 경고 UI 렌더링

## UI 요소
### scan panel
- 상단 요약 카드
  - 위험도 상태, 짧은 설명, risk score 표시
- `문제 이유`
  - `highlight_targets` 와 결과 요약을 바탕으로 왜 문제인지 설명
- `권장 확인 사항`
  - `recommended_actions` 기반 안내
- `운영 정보`
  - 현재 페이지 URL, 로컬 backend 주소, 데모 페이지 주소
- 본문 내 빨간 하이라이트
  - `css_class = safe-ticket-highlight-danger` 기준
- 접을 수 있는 기술 세부
  - payload preview, raw scan response 표시

### chat panel
- 현재 스캔 결과를 바탕으로 추가 질문을 주고받는 인터페이스
- 위험 요약과 별개로 “왜 이런 판단이 나왔는지”를 대화형으로 보강
- 상세 분석 페이지로 이동하기 전 빠른 탐색 역할

## 필요한 API
- `POST /api/v1/scans`
- `GET /api/v1/scans/{scan_id}`
- `POST /api/v1/scans/{scan_id}/feedback`

## 메모
- 확장 프로그램 UI에서 직접 백엔드를 호출할 경우, 백엔드 CORS allowlist 에 extension origin 을 포함해야 한다.
- 현재 MVP 는 수동으로 `백엔드로 전송` 버튼을 눌러 스캔을 시작한다.
- 향후에는 우측 고정 패널을 `chat panel` 로 전환하고, 별도 `scan panel` 을 분석 전용 패널로 분리한다.

## 로컬 실행
1. 백엔드와 데모 페이지 서버 실행
   - `DB_PORT=5433 docker compose up --build`
2. 확장 프로그램 빌드
   - `pnpm --dir apps/frontend/web-demo build`
3. Chrome 에서 `chrome://extensions` 열기
4. `개발자 모드` 활성화
5. `압축해제된 확장 프로그램을 로드합니다` 선택
6. `apps/frontend/web-demo/dist` 디렉토리 선택
7. 데모 페이지 접속
   - `http://localhost:3000/product/227242032.html`

## 핵심 파일
- `apps/frontend/web-demo/public/manifest.json`
- `apps/frontend/web-demo/src/main.tsx`
- `apps/frontend/web-demo/src/App.tsx`
- `apps/frontend/shared/joonggonara.ts`
- `apps/frontend/shared/scan-api.ts`
