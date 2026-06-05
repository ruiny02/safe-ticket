FROM python:3.13-slim

WORKDIR /app

# Install the pipeline API runtime dependencies.
COPY apps/pipeline/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy the pipeline service source so the image can run without bind mounts.
COPY apps/pipeline /app/apps/pipeline

EXPOSE 8010

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010", "--app-dir", "/app/apps/pipeline"]
