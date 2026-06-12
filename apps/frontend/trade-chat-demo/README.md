# Trade Chat Demo Pages

중고나라와 번개장터 거래 채팅을 흉내낸 정적 페이지입니다.

현재 Chrome extension은 이 폴더를 직접 로드하지 않습니다. 단일 확장 진입점은 `apps/frontend/web-demo`입니다. `pnpm --dir apps/frontend/web-demo build` 후 `apps/frontend/web-demo/dist`를 Chrome에서 Load unpacked로 로드합니다.

## Files

- `joongna-chat.html`: 중고나라 거래 채팅 데모
- `bunjang-chat.html`: 번개장터 거래 채팅 데모
- `styles.css`: 두 데모 페이지 공통 스타일
- `demo-parser.js`: 메시지를 읽어 숨겨진 payload와 `window.safeTicketDemoPayload`를 만드는 샘플 parser
- `safe-ticket-page-parser.js`: 통합 전 plain JavaScript parser 참고 파일
- `safe-ticket-chat-scan.js`: 통합 전 overlay 참고 파일
- `safe-ticket-external-lookup-display.js`: external lookup 표시 helper 참고 파일

## Parser Hooks

통합 extension은 아래 속성을 기준으로 채팅 페이지를 읽습니다.

- 전체 채팅 루트: `[data-safe-ticket-chat]`
- 플랫폼 구분: `data-platform="joonggonara"` 또는 `data-platform="bunjang"`
- 개별 메시지: `[data-chat-message]`
- 메시지 id: `data-message-id`
- 발화자 역할: `data-role="seller"` 또는 `data-role="buyer"`
- 발화자 이름: `data-speaker`
- 메시지 시간: `data-timestamp`

## Backend Scan Flow

통합 extension은 `apps/frontend/shared/trade-chat.ts` parser를 사용합니다.

1. 상품 제목, 가격, 지역, 판매자, 구매자 정보를 읽습니다.
2. `[data-chat-message]` 요소를 읽어 `content_blocks`를 만듭니다.
3. `POST http://localhost:8000/api/v1/scans`로 전송합니다.
4. `GET http://localhost:8000/api/v1/scans/{scan_id}`를 polling합니다.
5. 백엔드 `highlight_targets`와 채팅 데모용 local rule 결과를 합쳐 페이지에 표시합니다.

채팅 데모용 local rule은 아래 신호를 보강합니다.

- 안전결제 / 번개페이 회피
- 카톡 / 문자 등 외부 연락 유도
- 예약금 / 선입금 요구
- 오늘 안에 입금, 다음 분께 넘김 같은 시간 압박
- 농협 304, 케이뱅크 1102, 카카오뱅크 355 계좌 패턴

스캔 완료 후 통합 패널에서 아래 링크가 활성화됩니다. 주소는 build 시점의 `VITE_SAFE_TICKET_FRONTEND_BASE_URL` 또는 현재 demo 서버 origin을 기준으로 만들어집니다.

- 대시보드: `<FRONTEND_BASE_URL>/report/#/dashboard?scanId=<scan_id>`
- 리포트: `<FRONTEND_BASE_URL>/report/#/reports/<scan_id>`

## Chrome Extension Loading

1. `pnpm --dir apps/frontend/web-demo build`로 통합 extension을 빌드합니다.
2. Chrome에서 `chrome://extensions`를 엽니다.
3. `개발자 모드`를 켭니다.
4. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
5. `apps/frontend/web-demo/dist`를 선택합니다.
6. 아래 페이지에 접속한 뒤 새로고침합니다.

```text
http://localhost:3000/product/227242032.html
http://localhost:3000/joongna-chat.html
http://localhost:3000/bunjang-chat.html
```

주의: HTML 파일을 `file://`로 직접 열면 백엔드 CORS 설정에 따라 요청이 막힐 수 있습니다. Docker frontend 또는 허용된 서버 origin으로 서빙하세요.
