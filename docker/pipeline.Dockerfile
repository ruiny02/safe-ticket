FROM python:3.13-slim

WORKDIR /app

# Stage-0 placeholder image.
# When pipeline scaffold code is added, enable dependency installation like below:
# COPY apps/pipeline/requirements.txt /tmp/requirements.txt
# RUN pip install --no-cache-dir -r /tmp/requirements.txt

EXPOSE 8010

CMD ["python", "-m", "http.server", "8010", "--directory", "/app/apps/pipeline"]
