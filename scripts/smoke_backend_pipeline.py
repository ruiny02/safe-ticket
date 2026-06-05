"""Smoke test for the Docker backend-to-pipeline flow.

Run after `docker compose up --build` to verify:
1. backend is reachable,
2. backend can reach pipeline,
3. scan creation completes through the pipeline.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request


BASE_URL = "http://localhost:8000"


def request_json(method: str, path: str, body: dict | None = None) -> dict:
    """Send a JSON HTTP request using only Python standard library modules."""
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers=headers,
        method=method,
    )

    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_backend() -> None:
    """Wait until the backend ready endpoint responds."""
    for _ in range(30):
        try:
            request_json("GET", "/api/v1/health/ready")
            return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1)

    raise RuntimeError("Backend did not become ready within 30 seconds.")


def build_scan_payload() -> dict:
    """Return a payload that should trigger temporary pipeline risk rules."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/123",
        "page_title": "Concert ticket sale",
        "price": 120000,
        "seller": {
            "seller_id": "seller123",
            "nickname": "ticket-seller",
        },
        "content_blocks": [
            {
                "block_id": "body-1",
                "text": "Please use bank transfer and Kakao for the concert ticket.",
            }
        ],
    }


def main() -> None:
    """Run the smoke test and print the final scan result."""
    wait_for_backend()

    pipeline_health = request_json("GET", "/api/v1/health/pipeline")
    if not pipeline_health.get("pipeline_reachable"):
        raise RuntimeError(f"Pipeline is not reachable: {pipeline_health}")

    created = request_json("POST", "/api/v1/scans", build_scan_payload())
    scan_id = created["scan_id"]

    for _ in range(15):
        result = request_json("GET", f"/api/v1/scans/{scan_id}")
        if result["status"] in {"completed", "failed", "partial"}:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            if result["status"] != "completed":
                raise RuntimeError(f"Scan did not complete successfully: {result}")
            return
        time.sleep(1)

    raise RuntimeError(f"Scan {scan_id} did not finish within 15 seconds.")


if __name__ == "__main__":
    main()
