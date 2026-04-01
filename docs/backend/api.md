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
      "reason": "안전거래 회피 표현"
    }
  ],
  "similar_cases": [
    {
      "case_id": "case_123",
      "score": 0.81,
      "summary": "외부 메신저 이동 후 선입금 유도 사례"
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

### `POST /api/v1/scans/{scan_id}/chat`
특정 스캔 결과를 기반으로 추가 질문

요청 예시:
```json
{
  "question": "토스 아이디로 결제하자고 하는데 괜찮나요?"
}
```

응답 예시:
```json
{
  "answer": "현재 탐지 결과 기준으로는 위험 신호가 존재합니다.",
  "checklist": [
    "플랫폼 내 결제수단 우선 사용",
    "판매자 실명과 계좌 일치 여부 확인"
  ],
  "references": [
    {
      "case_id": "case_123",
      "summary": "외부 메신저 이동 후 선입금 유도 사례"
    }
  ]
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
- Web 리포트 페이지도 동일한 scan 조회 API를 사용한다.
