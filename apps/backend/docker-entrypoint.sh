#!/bin/sh
set -e

cd /app

echo "Running backend database migrations..."
alembic -c apps/backend/alembic.ini upgrade head

echo "Starting backend API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir /app/apps/backend
