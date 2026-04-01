FROM python:3.11-slim

WORKDIR /app

# Stage-0 placeholder image.
# When backend scaffold code is added, enable dependency installation like below:
# COPY requirements.txt /tmp/requirements.txt
# RUN pip install --no-cache-dir -r /tmp/requirements.txt

EXPOSE 8000

CMD ["python", "-m", "http.server", "8000", "--directory", "/app/apps/backend"]
