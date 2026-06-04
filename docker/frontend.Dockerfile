FROM node:20-alpine AS report-builder

WORKDIR /app

ARG VITE_SAFE_TICKET_API_BASE_URL
ARG VITE_SAFE_TICKET_FRONTEND_BASE_URL
ENV VITE_SAFE_TICKET_API_BASE_URL=$VITE_SAFE_TICKET_API_BASE_URL
ENV VITE_SAFE_TICKET_FRONTEND_BASE_URL=$VITE_SAFE_TICKET_FRONTEND_BASE_URL

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
COPY apps/frontend/trade-chat-demo/joongna-chat.html /app/apps/frontend/site/joongna-chat.html
COPY apps/frontend/trade-chat-demo/bunjang-chat.html /app/apps/frontend/site/bunjang-chat.html
COPY apps/frontend/trade-chat-demo/styles.css /app/apps/frontend/site/styles.css
COPY apps/frontend/trade-chat-demo/demo-parser.js /app/apps/frontend/site/demo-parser.js
COPY apps/frontend/trade-chat-demo/safe-ticket-page-parser.js /app/apps/frontend/site/safe-ticket-page-parser.js
COPY --from=report-builder /app/apps/frontend/report-page/dist /app/apps/frontend/site/report

EXPOSE 3000

CMD ["python", "-m", "http.server", "3000", "--directory", "/app/apps/frontend/site"]
