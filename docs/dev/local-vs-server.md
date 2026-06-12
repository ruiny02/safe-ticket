# Local Docker vs Server Deployment Manual

이 문서는 Safe Ticket 코드를 수정할 때 **로컬 Docker 개발용 코드**와 **서버 배포용 코드**를 헷갈리지 않기 위한 기준을 정리한다.

핵심 원칙은 간단하다.

- 코드에는 가능하면 특정 IP, 포트, extension ID를 박지 않는다.
- 로컬과 서버의 차이는 `.env`, Docker compose build arg, GitHub Actions secret, runtime config로 주입한다.
- `localhost`는 항상 “사용자 자신의 컴퓨터”를 뜻한다. AWS 서버를 뜻하지 않는다.

---

## 1. 환경별 의미

### 로컬 Docker 개발

로컬 개발은 내 노트북에서 Docker Compose를 띄우고 직접 테스트하는 흐름이다.

기본 주소:

- frontend/report/demo: `http://localhost:3000`
- backend: `http://localhost:8000`
- pipeline: `http://localhost:8010`
- PostgreSQL: `127.0.0.1:${DB_PORT}`
- lookup-browser/noVNC: `http://localhost:6080`

주의:

- `DB_PORT=5433 docker compose up --build`처럼 로컬 포트 충돌을 피할 수 있다.
- 이때 frontend가 호출해야 하는 backend는 `http://localhost:8000`이 맞다.
- Chrome extension도 로컬 테스트용으로 빌드했다면 `localhost` backend를 바라봐야 한다.

### 서버 배포

서버 배포는 AWS Lightsail/VPS 같은 원격 서버에서 Docker Compose를 띄우고, 사용자의 브라우저가 그 서버에 접속하는 흐름이다.

예시 주소:

- frontend/report/demo: `http://<SERVER_HOST>:3000`
- backend: `http://<SERVER_HOST>:8000`
- lookup-browser/noVNC: `http://<SERVER_HOST>:6080`

주의:

- 서버에서 build된 report page가 `http://localhost:8000`을 호출하면 안 된다.
- 사용자의 브라우저에서 `localhost:8000`은 AWS 서버가 아니라 사용자 PC다.
- 서버 배포 시에는 frontend build arg를 서버 public IP 또는 도메인으로 넣어야 한다.

---

## 2. 코드 작성 시 지켜야 할 기준

### 하드코딩하면 안 되는 값

아래 값은 코드에 직접 박지 않는다.

- AWS public IP 또는 도메인: 예 `<SERVER_HOST>`
- 임시 tunnel URL
- backend base URL
- frontend base URL
- Chrome extension ID
- API key
- DB password

대신 아래 경로로 주입한다.

- `.env`
- `.env.example`
- `docker-compose.yml` build args
- GitHub Actions secrets/variables
- Vite env: `VITE_SAFE_TICKET_API_BASE_URL`, `VITE_SAFE_TICKET_FRONTEND_BASE_URL`

### 코드에 남겨도 되는 값

아래 값은 개발 편의상 기본 fallback으로 둘 수 있다.

- `http://localhost:8000`
- `http://localhost:3000`
- 테스트용 scan ID fixture
- 데모 HTML 경로

단, fallback은 서버 배포 build arg가 없을 때만 사용되어야 한다.

---

## 3. frontend/report page 체크포인트

관련 파일:

- `apps/frontend/shared/runtime-config.ts`
- `apps/frontend/shared/scan-api.ts`
- `apps/frontend/shared/chat-api.ts`
- `apps/frontend/shared/fetch-options.ts`
- `apps/frontend/report-page/src/App.tsx`

확인할 것:

- report page가 backend URL을 어디서 가져오는지 확인한다.
- 서버 배포용 build에서는 `VITE_SAFE_TICKET_API_BASE_URL`이 서버 주소인지 확인한다.
- 로컬 개발용 build에서는 `VITE_SAFE_TICKET_API_BASE_URL=http://localhost:8000`인지 확인한다.
- browser console에서 `Failed to fetch`가 뜨면 먼저 실제 요청 URL을 확인한다.

로컬 build:

```bash
VITE_SAFE_TICKET_API_BASE_URL=http://localhost:8000 \
VITE_SAFE_TICKET_FRONTEND_BASE_URL=http://localhost:3000 \
pnpm --dir apps/frontend/report-page build
```

서버 build 예시:

```bash
SERVER_HOST=your.server.example \
VITE_SAFE_TICKET_API_BASE_URL=http://${SERVER_HOST}:8000 \
VITE_SAFE_TICKET_FRONTEND_BASE_URL=http://${SERVER_HOST}:3000 \
pnpm --dir apps/frontend/report-page build
```

---

## 4. Chrome extension 체크포인트

관련 파일:

- `apps/frontend/web-demo/public/manifest.json`
- `apps/frontend/web-demo/public/popup.js`
- `apps/frontend/web-demo/src/content-root.ts`
- `apps/frontend/shared/page-target.ts`
- `apps/frontend/shared/runtime-config.ts`

확인할 것:

- extension을 로컬에서 쓸 것인지, 서버 데모 페이지에서 쓸 것인지 먼저 정한다.
- `manifest.json`의 `host_permissions`에 실제 호출할 backend/frontend origin이 포함되어야 한다.
- content script `matches`에 실제로 열 페이지가 포함되어야 한다.
- 서버 데모의 IP/도메인이 바뀔 수 있으므로 HTTP demo host는 manifest에서 넓게 허용하고, 실제 패널 표시 여부는 `page-target.ts`의 안전한 경로 필터로 제한한다.
- extension을 다시 build한 뒤 Chrome `Reload`를 눌러야 새 코드가 반영된다.
- `dist`는 build 산출물이므로 코드 수정 후 항상 다시 build한다.

로컬 extension build:

```bash
VITE_SAFE_TICKET_API_BASE_URL=http://localhost:8000 \
VITE_SAFE_TICKET_FRONTEND_BASE_URL=http://localhost:3000 \
pnpm --dir apps/frontend/web-demo build
```

서버 extension build 예시:

```bash
SERVER_HOST=your.server.example \
VITE_SAFE_TICKET_API_BASE_URL=http://${SERVER_HOST}:8000 \
VITE_SAFE_TICKET_FRONTEND_BASE_URL=http://${SERVER_HOST}:3000 \
pnpm --dir apps/frontend/web-demo build
```

서버용 extension에서 주의할 점:

- AWS IP 또는 도메인이 `manifest.json` 권한에 없으면 fetch나 content script 주입이 막힐 수 있다.
- backend CORS allowlist에 `chrome-extension://<EXTENSION_ID>`가 있어야 한다.
- unpacked extension ID를 고정하려면 manifest `key`와 private key 관리 정책을 따로 유지한다.

---

## 5. backend/CORS 체크포인트

관련 파일:

- `apps/backend/app/main.py`
- `apps/backend/app/core/config.py`
- `.env`
- `.env.example`

확인할 것:

- `BACKEND_CORS_ORIGINS`에 현재 frontend origin이 들어가야 한다.
- 로컬 report page는 `http://localhost:3000`, `http://127.0.0.1:3000`을 허용해야 한다.
- extension에서 직접 backend를 호출하면 `chrome-extension://<EXTENSION_ID>`도 허용해야 한다.
- 서버 배포에서는 서버 frontend origin도 허용해야 한다.

예시:

```env
BACKEND_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://<SERVER_HOST>:3000,chrome-extension://<EXTENSION_ID>
```

주의:

- `.env`를 수정한 뒤 단순 `docker compose restart backend`만으로는 반영되지 않을 수 있다.
- 환경변수 변경 후에는 backend 컨테이너를 재생성한다.

```bash
docker compose up -d --force-recreate --no-deps backend
```

---

## 6. Private Network Access 관련 주의

Chrome은 public page에서 private/local network로 fetch할 때 Private Network Access 정책을 적용한다.

관련 파일:

- `apps/frontend/shared/fetch-options.ts`

기준:

- `localhost`, `127.x.x.x`, `::1` 요청에는 `targetAddressSpace: "local"`을 붙이면 안 된다.
- `10.x.x.x`, `172.16.x.x ~ 172.31.x.x`, `192.168.x.x` 같은 사설망 IP 요청에만 필요할 수 있다.
- 서버 public IP 요청에는 붙이지 않는다.

증상:

```text
Request had a target IP address space of `local` yet the resource is in address space `loopback`
```

이 메시지가 뜨면 CORS allowlist보다 `fetch-options.ts`의 address-space 옵션을 먼저 확인한다.

---

## 7. Docker Compose 체크포인트

관련 파일:

- `docker-compose.yml`
- `docker/frontend.Dockerfile`
- `.env`

로컬용으로 괜찮은 설정:

```yaml
args:
  VITE_SAFE_TICKET_API_BASE_URL: http://localhost:8000
  VITE_SAFE_TICKET_FRONTEND_BASE_URL: http://localhost:3000
```

서버 배포용으로 필요한 설정:

```yaml
args:
  VITE_SAFE_TICKET_API_BASE_URL: http://<SERVER_IP_OR_DOMAIN>:8000
  VITE_SAFE_TICKET_FRONTEND_BASE_URL: http://<SERVER_IP_OR_DOMAIN>:3000
```

권장:

- `docker-compose.yml`에 서버 IP를 직접 박기보다 `.env` 값을 사용한다.
- GitHub Actions CD에서는 secret/variable로 서버 URL을 넣고 build한다.

예시 방향:

```yaml
args:
  VITE_SAFE_TICKET_API_BASE_URL: ${VITE_SAFE_TICKET_API_BASE_URL:-http://localhost:8000}
  VITE_SAFE_TICKET_FRONTEND_BASE_URL: ${VITE_SAFE_TICKET_FRONTEND_BASE_URL:-http://localhost:3000}
```

---

## 8. PR/merge 전 체크리스트

### 로컬 개발 PR

- [ ] `localhost` 기준으로 로컬 compose가 뜨는지 확인
- [ ] `http://localhost:3000/report/` 접속 확인
- [ ] `http://localhost:8000/api/v1/health/ready` 확인
- [ ] extension을 다시 build하고 Chrome에서 Reload
- [ ] console에 `Failed to fetch`가 없는지 확인

### 서버 배포 PR

- [ ] frontend build arg가 서버 IP/도메인을 바라보는지 확인
- [ ] `manifest.json`에 서버 frontend/backend 권한이 있는지 확인
- [ ] backend CORS에 서버 frontend origin과 extension origin이 있는지 확인
- [ ] GitHub Actions CD에서 같은 env가 주입되는지 확인
- [ ] 서버에서 `docker compose ps`와 health endpoint 확인

### 공통 테스트

```bash
pnpm --dir apps/frontend/web-demo test
pnpm --dir apps/frontend/report-page test
pytest apps/backend/tests
docker compose config
```

---

## 9. 빠른 판단 기준

### 로컬에서는 되는데 서버에서 안 됨

먼저 확인할 것:

- build된 JS 안에 `localhost:8000`이 남아 있는가
- server frontend가 사용자의 브라우저에서 backend public URL을 호출하는가
- AWS 방화벽에서 `3000`, `8000` 포트가 열려 있는가
- backend CORS에 서버 frontend origin이 있는가

### 서버에서는 되는데 로컬에서 안 됨

먼저 확인할 것:

- local extension dist가 서버 URL을 바라보고 있지 않은가
- 로컬 backend가 실제로 떠 있는가
- `DB_PORT` 충돌로 compose가 다른 상태가 아닌가
- Chrome extension Reload를 했는가

### extension만 안 됨

먼저 확인할 것:

- `apps/frontend/web-demo/dist`를 다시 build했는가
- Chrome에서 Reload했는가
- `manifest.json` host permission이 맞는가
- backend CORS에 extension ID가 들어갔는가
- request URL이 local/server 중 어느 쪽인지 console에서 확인했는가

---

## 10. 결론

로컬 Docker와 서버 배포는 같은 코드base를 쓰지만, 브라우저 관점의 URL 의미가 다르다.

- 로컬 개발: `localhost`가 맞다.
- 서버 배포: `localhost`가 틀릴 가능성이 높다.
- 코드에는 특정 환경 값을 박지 말고 build/runtime 설정으로 분리한다.
- PR 전에는 build 산출물이 어떤 backend/frontend URL을 바라보는지 확인한다.
