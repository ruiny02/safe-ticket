
# Trade Chat Demo Pages

중고나라와 번개장터 거래 채팅을 흉내낸 정적 페이지입니다.

## Files

- `joongna-chat.html`: 중고나라 거래 채팅 데모
- `bunjang-chat.html`: 번개장터 거래 채팅 데모
- `styles.css`: 두 데모 페이지 공통 스타일
- `demo-parser.js`: 메시지를 읽어 숨겨진 payload와 `window.safeTicketDemoPayload`를 만드는 샘플 parser
- `safe-ticket-chat-scan.js`: 채팅 메시지를 백엔드 스캔 API로 보내고 응답의 `highlight_targets`를 말풍선에 반영하는 샘플 overlay
- `manifest.json`: `chrome://extensions`에서 이 폴더를 바로 로드하기 위한 Manifest V3 설정

## Parser Hooks

extension에서 나중에 잡기 쉽게 아래 속성을 넣었습니다.

- 전체 채팅 루트: `[data-safe-ticket-chat]`
- 플랫폼 구분: `data-platform="joonggonara"` 또는 `data-platform="bunjang"`
- 개별 메시지: `[data-chat-message]`
- 메시지 id: `data-message-id`
- 발화자 역할: `data-role="seller"` 또는 `data-role="buyer"`
- 발화자 이름: `data-speaker`
- 메시지 시간: `data-timestamp`

## Suggested Payload Shape

`demo-parser.js`는 아래 흐름을 예시로 보여줍니다.

1. 상품 제목, 가격, 지역, 판매자, 구매자 정보를 읽습니다.
2. 채팅 메시지를 `content_blocks`와 `chat_messages`로 변환합니다.
3. 외부 메신저 이동, 안전결제 회피, 선입금 압박, 계좌 정보, 시간 압박 표현을 간단히 탐지합니다.
4. 화면에는 노출하지 않고, 숨겨진 `<pre data-payload-output>`과 `window.safeTicketDemoPayload`에 JSON을 넣습니다.

실제 extension에 붙일 때는 이 demo parser를 그대로 쓰기보다, 기존 `apps/frontend/shared` parser 구조에 `trade_chat` adapter로 옮기는 방식을 권장합니다.

## Backend Scan Flow

`safe-ticket-chat-scan.js`는 기존 상품 상세 extension MVP와 같은 흐름을 Chrome extension content script로 재현합니다.

1. `[data-chat-message]` 요소를 읽어 `content_blocks`를 만듭니다.
2. `POST http://localhost:8000/api/v1/scans`로 전송합니다.
3. `GET http://localhost:8000/api/v1/scans/{scan_id}`를 polling합니다.
4. 응답의 `highlight_targets`에 있는 `block_id`와 `matched_text`를 찾아 말풍선 안에 `<mark>`를 씌웁니다.

브라우저 콘솔에서 아래 값도 확인할 수 있습니다.

- `window.safeTicketDemoPayload`: 채팅 전용 확장 payload 예시
- `window.safeTicketBackendPayload`: 실제 백엔드로 보낸 현재 payload
- `window.safeTicketBackendResult`: 백엔드 polling 결과

현재 채팅 화면은 처음 열렸을 때 위험 문구를 미리 하이라이트하지 않습니다. `스캔 실행`을 누른 뒤 백엔드가 돌려준 `highlight_targets`와 채팅 데모용 로컬 rule 결과만 실제 말풍선에 `<mark>`로 표시합니다.

백엔드 MVP가 아직 계좌 rule 중심이므로, 채팅 데모에서는 백엔드 응답에 아래 로컬 데모 rule을 합쳐 하이라이트합니다.

- 안전결제 / 번개페이 회피
- 카톡 / 문자 등 외부 연락 유도
- 예약금 / 선입금 요구
- 오늘 안에 입금, 다음 분께 넘김 같은 시간 압박
- 농협 304, 케이뱅크 1102 적금계좌 패턴

적금계좌 rule 확인을 위해 아래 패턴을 샘플 메시지에 넣었습니다.

- 중고나라: `농협은행 304-1234-5678-90`
- 번개장터: `케이뱅크 1102-1234-5678`

스캔 플로팅창은 헤더를 잡고 드래그할 수 있고, 브라우저가 지원하는 경우 오른쪽 아래 모서리로 크기를 조절할 수 있습니다.

스캔이 완료되면 플로팅창의 `대시보드 보기`와 `리포트 보기` 버튼이 활성화됩니다.

- 대시보드: `http://localhost:5173/report/#/dashboard?scanId=<scan_id>`
- 리포트: `http://localhost:5173/report/#/reports/<scan_id>`

이 URL은 기존 `safe-ticket` report-page 구현의 hash route를 기준으로 합니다. 채팅 데모를 `localhost:3000`에서 서빙 중이면 report app과 포트가 겹치므로, report app은 별도 포트에서 띄우는 것을 기본값으로 잡았습니다.

report app을 켜는 예시:

```bat
cd "C:\Users\GUSEOYEONG\Documents\New project\safe-ticket"
corepack pnpm --dir apps/frontend/report-page dev -- --host 127.0.0.1 --port 5173
```

다른 포트로 띄우고 싶으면 브라우저 콘솔에서 아래처럼 바꿀 수 있습니다.

```js
localStorage.setItem("safeTicketReportBaseUrl", "http://localhost:5174/report/");
```

하단 `질문하기` 영역은 챗봇 UI만 구현되어 있습니다. 현재 백엔드에 대화용 endpoint가 없으므로 실제 답변 대신 API 미연결 안내 메시지를 표시합니다.

주의: HTML 파일을 `file://`로 직접 열면 백엔드 CORS 설정에 따라 요청이 막힐 수 있습니다. 그 경우 이 폴더를 `http://localhost:3000` 같은 허용된 origin으로 서빙하거나, 백엔드의 `BACKEND_CORS_ORIGINS`에 현재 origin을 추가하세요.
## Chrome Extension Loading

1. 채팅 데모 서버를 켭니다.

```bat
npx serve -l 3000
```

2. 백엔드를 켭니다.

```bat
set BACKEND_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

PowerShell이면 CORS 설정은 아래처럼 씁니다.

```powershell
$env:BACKEND_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

3. Chrome에서 `chrome://extensions`를 엽니다.
4. `개발자 모드`를 켭니다.
5. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
6. 해당 폴더를 선택합니다.
7. 아래 페이지에 접속한 뒤 새로고침합니다.

```text
http://localhost:3000/joongna-chat.html
http://localhost:3000/bunjang-chat.html
```

확장 프로그램이 정상 로드되면 safe-ticket 플로팅창이 나타납니다. `스캔 실행`을 누르면 `localhost:8000` 백엔드로 채팅 내용을 보내고, 결과를 받아 하이라이트를 표시합니다.

