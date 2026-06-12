# Project Scope

## 현재 발표 빌드 범위
- Chrome Extension 하나로 상품 상세 페이지와 거래 채팅 데모를 모두 처리한다.
- Extension은 페이지 텍스트를 파싱해 `POST /api/v1/scans` 로 보내고, `GET /api/v1/scans/{scan_id}` 를 polling 한다.
- Backend는 rule, 외부조회, 유사 사례 검색, LLM/RAG 설명 생성을 조합해 scan result를 만든다.
- Report page는 scan result를 기준으로 dashboard, narrative report, settings 화면을 제공한다.
- Settings는 로그인 없이 사용자 맥락만 입력한다.
  - 나이
  - 중고거래 경험: 초급 / 중급 / 고급

## 현재 범위에서 제외
- 로그인 / 회원가입 / 계정 인증
- 자동 신고 제출
- 외부 서비스 OTP 자동화
- 운영용 개인정보 저장 정책 완성

## 다음 확장 후보
- 실제 서비스 배포용 HTTPS / 도메인 / 인증 구성
- lookup 결과 캐싱과 보존 정책
- extension UI와 report page의 공통 컴포넌트 정리
- 더 많은 marketplace/chat layout 파서 추가
