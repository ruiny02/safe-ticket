# 100개 데이터 재수집 플로우

이 문서는 기존 수집 데이터를 비우고 새로 100개 데이터를 수집하는 초보자용 실행 순서입니다.

## 1. Docker 켜기

Docker Desktop을 먼저 켭니다.

그 다음 `docker-compose.yml`이 있는 프로젝트 폴더로 이동합니다.

```bash
cd safe_ticket_pipeline
```

서비스를 실행합니다.

```bash
docker compose up -d
```

## 2. 기존 데이터 삭제 + 100개 새 수집

아래 스크립트 하나만 실행합니다.

```bash
./scripts/collect_100_cases.sh
```

이 스크립트는 내부적으로 다음 일을 합니다.

1. 기존 파이프라인 산출물 삭제
2. DB의 기존 pipeline 데이터 삭제
3. 마켓플레이스에서 총 100개 raw post 수집 시도
4. 텍스트 전처리 데이터 생성
5. 메모리/RAG import 데이터 생성
6. 임베딩 데이터 생성
7. DB에 processed 데이터와 embedding 데이터 적재

## 3. 새로 생기는 파일

원본 데이터 인덱스:

```text
apps/pipeline/data/raw/raw_posts.jsonl
```

텍스트 전처리 데이터:

```text
apps/pipeline/data/processed/text_preprocessed_posts.jsonl
```

전체 processed 데이터:

```text
apps/pipeline/data/processed/processed_posts.jsonl
```

백엔드 RAG import용 데이터:

```text
apps/pipeline/data/processed/memory_cases.jsonl
```

임베딩 데이터:

```text
apps/pipeline/data/embeddings/memory_case_embeddings.jsonl
```

## 참고

`--total-links 100`은 raw post 100개 수집을 목표로 합니다. 사이트 상태, 차단, 검색 결과 수, 유효성 검사 결과에 따라 최종 valid post 수는 100보다 적을 수 있습니다.

Playwright에서 Chromium 실행 파일이 없다는 오류가 나오면 pipeline 이미지를 다시 빌드합니다.

```bash
docker compose build pipeline
docker compose up -d pipeline
```
