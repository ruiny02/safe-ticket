FROM python:3.13-slim

WORKDIR /app
# Copy the backend service dependency list and install the runtime.
COPY apps/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy the application source so the image can run independently.
COPY apps/backend /app/apps/backend

EXPOSE 8000

# Start the FastAPI app with uvicorn when the backend container boots.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app/apps/backend"]
