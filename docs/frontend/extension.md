# Extension

## 역할
크롬 확장 프로그램은 사용자가 실제로 보고 있는 거래 페이지 위에서 **즉시 경고를 보여주는 인터페이스**다.

## 현재 MVP 구현
- `apps/frontend/web-demo` 는 이제 standalone 웹페이지가 아니라 **Manifest V3 content script 확장 프로그램**이다.
- 확장 프로그램은 `localhost` 데모 페이지와 실제 `web.joongna.com/product/*` 페이지를 대상으로 동작한다.
- 파싱과 API payload 생성은 `apps/frontend/shared` 아래 공용 로직을 그대로 사용한다.
- 현재는 페이지 우측 상단 고정 패널을 띄우고, `POST /api/v1/scans` 호출 결과를 표시한다.

## 주요 동작
- 허용한 사이트의 거래 게시글 페이지에서만 동작
- 제목 / 본문 / 가격 / 판매자 정보 / 엔티티 후보를 추출
- 백엔드에 스캔 작업 생성 요청
- 결과가 나올 때까지 polling
- 위험 문구 하이라이트
- 위험 요약 배지 / 메시지 표시
- 상세 리포트 보기 버튼 제공
- 경찰 신고 / 신고 안내 버튼 제공

## 백엔드 연동 흐름
1. 현재 페이지에서 `content_blocks` 추출
2. `POST /api/v1/scans` 호출
3. `scan_id` 수신
4. `GET /api/v1/scans/{scan_id}` polling
5. `completed` / `partial` 결과 수신
6. 하이라이트와 경고 UI 렌더링

## UI 요소
- 상단 또는 우측의 위험도 배지
- 본문 내 하이라이트 표시
- 요약 메시지
- `상세 리포트 보기` 버튼
- `경찰 신고 / 신고 안내` 버튼

## 필요한 API
- `POST /api/v1/scans`
- `GET /api/v1/scans/{scan_id}`
- `POST /api/v1/scans/{scan_id}/feedback`

## 메모
- 현재 단계에서는 자동 신고를 하지 않는다.
- 경찰 버튼은 공식 신고 페이지나 신고 안내 페이지로 연결하는 수준으로 둔다.
- 확장 프로그램 UI에서 직접 백엔드를 호출할 경우, 백엔드 CORS allowlist 에 extension origin 을 포함해야 한다.

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
