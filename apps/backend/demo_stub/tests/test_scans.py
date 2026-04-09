from fastapi.testclient import TestClient

from apps.backend.demo_stub.main import app


client = TestClient(app)


def test_live_health_returns_ok():
    response = client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_scans_returns_queued_scan():
    payload = {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/123",
        "page_title": "아이유 콘서트 티켓 양도",
        "price": 120000,
        "seller": {
            "seller_id": "user123",
            "nickname": "급처",
        },
        "content_blocks": [
            {"block_id": "title", "text": "아이유 콘서트 티켓 양도"},
            {"block_id": "body-1", "text": "안전거래 안되고 카톡 주세요"},
        ],
    }

    response = client.post("/api/v1/scans", json=payload)

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert body["poll_after_ms"] == 2000
    assert body["scan_id"].startswith("scan_")


def test_post_scans_rejects_missing_content_blocks():
    payload = {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/123",
        "page_title": "아이유 콘서트 티켓 양도",
        "price": 120000,
        "seller": {
            "seller_id": "user123",
            "nickname": "급처",
        },
        "content_blocks": [],
    }

    response = client.post("/api/v1/scans", json=payload)

    assert response.status_code == 422


def test_scans_preflight_allows_chrome_extension_origin():
    response = client.options(
        "/api/v1/scans",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
