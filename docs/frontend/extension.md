# Chrome Extension

## 역할
Extension은 사용자가 보고 있는 거래 페이지에서 바로 scan을 실행하고, 결과 요약과 하이라이트를 보여준다.

## 현재 구조
- 단일 extension: `apps/frontend/extension`
- Manifest V3 content script
- 상품 상세 demo, 거래 채팅 demo, 실제 중고나라 상품 페이지를 같은 extension에서 처리
- 구 `trade-chat-demo` standalone extension 스크립트는 제거됨

## 동작 흐름
1. 지원 페이지인지 확인
2. 상품/채팅 텍스트, 가격, 판매자 정보, 계좌/전화번호 후보를 파싱
3. `POST /api/v1/scans` 로 scan 생성
4. `GET /api/v1/scans/{scan_id}` polling
5. 위험 요약, 외부조회 결과, 권장 행동, chatbot helper를 panel에 표시
6. `highlight_targets` 를 실제 DOM text span에 검증 후 표시
7. dashboard/report page link 제공

## Build / Load

```bash
pnpm --dir apps/frontend/extension build
```

Chrome:
1. `chrome://extensions`
2. Developer mode ON
3. Load unpacked
4. `apps/frontend/extension/dist` 선택

## Demo URLs
- `http://localhost:3000/product/227242032.html`
- `http://localhost:3000/joongna-chat.html`
- `http://localhost:3000/bunjang-chat.html`

## Notes
- Backend CORS allowlist에 extension origin이 포함되어야 한다.
- 발표 빌드에서는 로그인 UI를 제공하지 않는다.
- 사용자 맥락은 extension/report settings에서 로컬로 입력한 나이와 거래 경험만 사용한다.
