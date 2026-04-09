"""API tests that verify the dummy backend-to-pipeline request flow."""

from fastapi.testclient import TestClient

from app.main import app


# The shared test client exercises the API without starting a real server.
client = TestClient(app)


def build_scan_payload() -> dict:
    """Return a stable payload that matches the documented scan input shape."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/123",
        "page_title": "IU concert ticket sale",
        "price": 120000,
        "seller": {
            "seller_id": "user123",
            "nickname": "ticketmaster",
        },
        "content_blocks": [
            {
                "block_id": "title",
                "text": "Transfer me first and I will send the ticket after payment.",
            },
            {
                "block_id": "body-1",
                "text": "Please move to messenger for faster communication.",
            },
        ],
    }


def test_scan_flow_and_pipeline_debug() -> None:
    """Ensure the API can queue a scan and expose the dummy pipeline exchange."""
    create_response = client.post("/api/v1/scans", json=build_scan_payload())
    assert create_response.status_code == 202

    scan_id = create_response.json()["scan_id"]

    # Poll the completed result that the background task generated.
    scan_response = client.get(f"/api/v1/scans/{scan_id}")
    assert scan_response.status_code == 200
    assert scan_response.json()["status"] == "completed"

    # Inspect the exact outbound and inbound payloads used for dummy AI integration.
    debug_response = client.get(f"/api/v1/scans/{scan_id}/pipeline-debug")
    assert debug_response.status_code == 200
    debug_body = debug_response.json()
    assert debug_body["outbound_payload"]["scan_id"] == scan_id
    assert debug_body["inbound_payload"]["risk_level"] == "high"


def test_feedback_endpoint() -> None:
    """Ensure the feedback API behaves as expected after scan creation."""
    create_response = client.post("/api/v1/scans", json=build_scan_payload())
    scan_id = create_response.json()["scan_id"]

    feedback_response = client.post(
        f"/api/v1/scans/{scan_id}/feedback",
        json={"feedback_type": "helpful", "comment": "The dummy response is easy to inspect."},
    )
    assert feedback_response.status_code == 200
    assert feedback_response.json()["status"] == "saved"
