# Branch Strategy

## 브랜치
- `main`
- `develop`
- `feature/*`
- `fix/*`
- `docs/*`

## 작업 흐름
1. `develop` 에서 브랜치 생성
2. 작업 후 PR 생성
3. `develop` 에 merge
4. 안정화 후 `main` 에 merge

## 메모
- `main` 직접 push 금지
- 문서 수정은 `docs/*`
- 기능 개발은 `feature/*`
- 버그 수정은 `fix/*`
- 커밋 메시지는 짧은 키워드보다 설명적으로 길게 작성
