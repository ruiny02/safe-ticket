FROM python:3.13-slim

WORKDIR /app

COPY apps/frontend/demo /app/apps/frontend/demo

EXPOSE 3000

CMD ["python", "-m", "http.server", "3000", "--directory", "/app/apps/frontend/demo/joongna-product-demo"]
