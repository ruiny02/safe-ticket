FROM python:3.13-slim

WORKDIR /app
# Copy the backend service dependency list and install the runtime.
COPY apps/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
RUN python -m playwright install --with-deps chromium

# Copy the application source so the image can run independently.
COPY apps/backend /app/apps/backend
RUN chmod +x /app/apps/backend/docker-entrypoint.sh

EXPOSE 8000

# Run migrations before starting the FastAPI server.
CMD ["/app/apps/backend/docker-entrypoint.sh"]
