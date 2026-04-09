# Artifacts

## 목적

이 문서는 개발 중 생성되는 임시 산출물의 저장 위치와 Git 관리 규칙을 정리한다.

프로젝트 소스와 무관한 디버깅 결과물은 루트에 두지 않고, 성격에 맞는 임시 디렉토리로 모은다.

## 분류 규칙

### 1. 도구가 자동 생성하는 산출물

- 예시: Playwright MCP snapshot, console log
- 위치: `.playwright-mcp/`
- 정책: Git 추적 제외

이 디렉토리는 도구가 자동으로 생성하는 작업 폴더다. 파일명은 실행 시점에 따라 바뀌며 재현 가능한 소스가 아니라서 커밋 대상이 아니다.

### 2. 수동 디버깅/분석 산출물

- 예시: 렌더 결과 JSON, DOM 추출 JSON, 임시 비교 결과
- 위치: `.artifacts/<tool-name>/`
- 현재 예시: `.artifacts/playwright/`
- 정책: Git 추적 제외

개발자가 확인용으로 직접 만든 파일은 `.artifacts/` 아래에 둔다. 도구별로 하위 디렉토리를 나눠 두면 정리와 삭제가 쉽다.

## 현재 프로젝트 기준

- `.playwright-mcp/`
  - Playwright MCP가 자동 생성하는 snapshot 및 console 산출물
- `.artifacts/playwright/`
  - `playwright-render-check.json`
  - `product-text-node.json`

## Git 규칙

다음 경로는 `.gitignore`에 포함한다.

- `.playwright-mcp/`
- `.artifacts/`
- `playwright-report/`
- `test-results/`

## 운영 원칙

- 임시 확인용 파일은 루트 디렉토리에 두지 않는다.
- 재현 가능한 테스트 fixture가 아닌 한 산출물은 커밋하지 않는다.
- 장기 보관이 필요한 자료만 `docs/` 또는 `tests/fixtures/`로 승격한다.
- 디버깅이 끝난 산출물은 정리하거나 덮어써도 되는 상태를 유지한다.
