# API

## 기본 원칙
- Base Path: `/api/v1`
- 현재 단계에서는 API 인증을 붙이지 않는다.
- 스캔은 **비동기 처리**를 기본으로 한다.
- `POST /scans` 는 작업 생성만 하고, 실제 결과는 `GET /scans/{scan_id}` 로 조회한다.
- Extension과 Web 둘 다 같은 scan 조회 API를 사용한다.

## CORS 정책
크롬 확장 프로그램과 웹 프론트엔드가 백엔드를 호출하므로 **CORS allowlist** 를 명시적으로 둔다.

허용 대상 예시:
- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `chrome-extension://<EXTENSION_ID>`

구현 메모:
- FastAPI `CORSMiddleware` 사용
- `allow_origins` 는 환경변수 `BACKEND_CORS_ORIGINS` 로 관리
- 초기에 `*` 전체 허용으로 가지 않고 allowlist 를 유지

## 인증 / 인가 정책
- 현재 단계: 전부 public API
- 로그인 기능은 초기 구현 범위에 넣지 않는다.
- `.env.example` 의 JWT 관련 변수는 **주석 처리 상태**로 둔다.

## 스캔 처리 전략
### 왜 비동기인가
규칙 탐지 + 검색 + LLM 설명 생성을 한 요청 안에서 동기 처리하면 응답 시간이 길어질 수 있다.
그래서 `POST /scans` 는 작업 생성만 하고, 클라이언트가 이후 상태를 polling 하는 구조로 간다.

### 상태값
- `queued`
- `processing`
- `completed`
- `partial`
- `failed`

### partial 결과
다음 상황에서는 `partial` 을 허용한다.
- OpenAI timeout
- OpenAI rate limit
- LLM 설명 생성 실패

이 경우에도 아래 결과는 반환 가능하게 설계한다.
- 규칙 기반 위험 신호
- 유사 사례 검색 결과
- 최소 요약 메시지

## 타임아웃 / 재시도 전략
- `POST /scans` 응답 목표: **즉시 202 반환**
- 외부 LLM 호출 timeout: `OPENAI_API_TIMEOUT_SECONDS` (기본 8초)
- LLM 재시도: `OPENAI_MAX_RETRIES` (기본 1회)
- 429 / 5xx 는 짧은 backoff 후 재시도
- 그래도 실패하면 `partial` 처리

## Endpoint 목록

### `GET /api/v1/health/live`
프로세스 생존 여부 확인

응답 예시:
```json
{
  "status": "ok"
}
```

### `GET /api/v1/health/ready`
DB 연결 가능 여부 등 준비 상태 확인

응답 예시:
```json
{
  "status": "ready"
}
```

### `POST /api/v1/scans`
스캔 작업 생성

요청 예시:
```json
{
  "platform": "joonggonara",
  "page_url": "https://example.com/post/123",
  "page_title": "아이유 콘서트 티켓 양도",
  "price": 120000,
  "seller": {
    "seller_id": "user123",
    "nickname": "급처"
  },
  "content_blocks": [
    {
      "block_id": "title",
      "text": "아이유 콘서트 티켓 양도"
    },
    {
      "block_id": "body-1",
      "text": "안전거래 안되고 카톡 주세요"
    }
  ]
}
```

응답 예시 (`202 Accepted`):
```json
{
  "scan_id": "scan_001",
  "status": "queued",
  "poll_after_ms": 2000
}
```

### `GET /api/v1/scans/{scan_id}`
스캔 상태 / 결과 조회

응답 예시 (진행 중):
```json
{
  "scan_id": "scan_001",
  "status": "processing"
}
```

응답 예시 (완료):
```json
{
  "scan_id": "scan_001",
  "status": "completed",
  "risk_level": "high",
  "risk_score": 0.87,
  "summary": "안전거래 회피 및 외부 메신저 유도 표현이 감지되었습니다.",
  "risk_tags": [
    "avoid_safe_payment",
    "off_platform_contact"
  ],
  "evidence_items": [
    {
      "block_id": "body-1",
      "start": 0,
      "end": 12,
      "matched_text": "안전거래 안되고",
      "reason_code": "avoid_safe_payment",
      "reason": "안전거래 회피 표현",
      "css_class": "safe-ticket-highlight-danger"
    }
  ],
  "highlight_targets": [
    {
      "block_id": "body-1",
      "start": 20,
      "end": 26,
      "matched_text": "카카오뱅크",
      "reason_code": "bank_account_pattern",
      "reason": "은행명과 계좌번호 패턴이 함께 감지되었습니다.",
      "css_class": "safe-ticket-highlight-danger"
    }
  ],
  "similar_cases": [
    {
      "case_id": "case_123",
      "score": 0.81,
      "summary": "외부 메신저 이동 후 선입금 유도 사례"
    }
  ],
  "recommended_actions": [
    {
      "action": "은행 계좌 검증",
      "description": "입금 전에 계좌 예금주와 거래 맥락을 다시 확인하세요."
    }
  ],
  "report_url": "/report/scan_001"
}
```

응답 예시 (부분 결과):
```json
{
  "scan_id": "scan_001",
  "status": "partial",
  "risk_level": "medium",
  "risk_score": 0.61,
  "summary": "일부 위험 신호와 유사 사례가 감지되었지만 LLM 설명 생성에는 실패했습니다.",
  "degraded": true
}
```

### `POST /api/v1/scans/{scan_id}/feedback`
사용자 피드백 저장

요청 예시:
```json
{
  "feedback_type": "false_positive",
  "comment": "실제 정상 판매자였음"
}
```

응답 예시:
```json
{
  "status": "saved"
}
```

### `GET /api/v1/scans/{scan_id}/pipeline-debug`
백엔드가 파이프라인으로 넘긴 값과 파이프라인이 반환한 값을 같이 확인하는 디버그용 API

응답 예시:
```json
{
  "scan_id": "scan_001",
  "outbound_payload": {
    "scan_id": "scan_001",
    "platform": "joonggonara",
    "page_url": "https://example.com/post/123",
    "page_title": "아이유 콘서트 티켓 양도",
    "price": 120000,
    "seller": {
      "seller_id": "user123",
      "nickname": "급처"
    },
    "content_blocks": [
      {
        "block_id": "body-1",
        "text": "입금 은행 : 카카오뱅크 / 계좌 번호 : 3355-28-8620726"
      }
    ]
  },
  "inbound_payload": {
    "risk_level": "high",
    "risk_score": 0.87,
    "summary": "은행명과 계좌번호 패턴이 함께 감지되었습니다.",
    "risk_tags": [
      "bank_account_pattern"
    ],
    "evidence_items": [],
    "highlight_targets": [
      {
        "block_id": "body-1",
        "start": 8,
        "end": 14,
        "matched_text": "카카오뱅크",
        "reason_code": "bank_account_pattern",
        "reason": "은행명과 계좌번호 패턴이 함께 감지되었습니다.",
        "css_class": "safe-ticket-highlight-danger"
      }
    ],
    "similar_cases": [],
    "recommended_actions": [
      {
        "action": "은행 계좌 검증",
        "description": "입금 전에 계좌 예금주와 거래 맥락을 다시 확인하세요."
      }
    ],
    "degraded": false
  }
}
```

## 에러 응답 형식
```json
{
  "detail": "error message",
  "error_code": "SCAN_NOT_FOUND",
  "retryable": false
}
```

## 구현 메모
- 현재 단계에서는 in-process background 작업으로 시작하고, 작업량이 커지면 별도 worker / queue 로 확장한다.
- Extension은 `POST /scans` 후 `GET /scans/{scan_id}` 를 polling 한다.
- 완료 결과의 `highlight_targets` 는 extension이 페이지 본문에서 빨간 하이라이트를 그릴 때 사용한다.
- Web 리포트 페이지도 동일한 scan 조회 API를 사용한다.
