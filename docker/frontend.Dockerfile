FROM node:20-alpine AS report-builder

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/frontend/report-page/package.json /app/apps/frontend/report-page/package.json
COPY apps/frontend/shared /app/apps/frontend/shared
COPY apps/frontend/report-page /app/apps/frontend/report-page

RUN corepack enable
RUN pnpm install --frozen-lockfile
RUN pnpm --dir apps/frontend/report-page build

FROM python:3.13-slim

WORKDIR /app

COPY apps/frontend/demo/joongna-product-demo /app/apps/frontend/site
COPY --from=report-builder /app/apps/frontend/report-page/dist /app/apps/frontend/site/report

EXPOSE 3000

CMD ["python", "-m", "http.server", "3000", "--directory", "/app/apps/frontend/site"]
