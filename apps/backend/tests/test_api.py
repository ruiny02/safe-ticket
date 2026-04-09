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


def build_bank_pattern_payload() -> dict:
    """Return a payload that contains the KakaoBank pattern used in the demo page."""
    return {
        "platform": "joonggonara",
        "page_url": "https://example.com/post/456",
        "page_title": "tuki. 1ST ASIA TOUR 2026 IN SEOUL",
        "price": 163000,
        "seller": {
            "seller_id": "seller456",
            "nickname": "demo-seller",
        },
        "content_blocks": [
            {
                "block_id": "title",
                "text": "tuki. 1ST ASIA TOUR 2026 IN SEOUL",
            },
            {
                "block_id": "body-1",
                "text": (
                    "입금 은행 : 카카오뱅크\n"
                    "계좌 번호 : 3355-28-8620726\n"
                    "입금 후 기재 해드린 양식 작성 부탁드립니다."
                ),
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
    scan_body = scan_response.json()
    assert scan_body["status"] == "completed"
    assert scan_body["highlight_targets"] == [
        {
            "block_id": "title",
            "start": 0,
            "end": 17,
            "matched_text": "Transfer me first",
            "reason_code": "avoid_safe_payment",
            "reason": "The listing asks for money transfer before platform-safe payment.",
            "css_class": "safe-ticket-highlight-danger",
        },
        {
            "block_id": "body-1",
            "start": 15,
            "end": 24,
            "matched_text": "messenger",
            "reason_code": "off_platform_contact",
            "reason": "The listing tries to move the conversation off-platform.",
            "css_class": "safe-ticket-highlight-danger",
        },
    ]
    assert scan_body["evidence_items"] == scan_body["highlight_targets"]

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


def test_scan_highlights_kakaobank_account_pattern() -> None:
    """Ensure rule-based account detection marks the bank name and full account number."""
    create_response = client.post("/api/v1/scans", json=build_bank_pattern_payload())
    assert create_response.status_code == 202

    scan_id = create_response.json()["scan_id"]
    scan_response = client.get(f"/api/v1/scans/{scan_id}")
    assert scan_response.status_code == 200

    scan_body = scan_response.json()
    highlight_targets = scan_body["highlight_targets"]

    assert {
        "block_id": "body-1",
        "start": 8,
        "end": 13,
        "matched_text": "카카오뱅크",
        "reason_code": "bank_name_detected",
        "reason": "The listed bank name matches a monitored account-pattern rule.",
        "css_class": "safe-ticket-highlight-danger",
    } in highlight_targets
    assert {
        "block_id": "body-1",
        "start": 22,
        "end": 37,
        "matched_text": "3355-28-8620726",
        "reason_code": "bank_account_pattern",
        "reason": "This 카카오뱅크 account matches the monitored savings-account pattern.",
        "css_class": "safe-ticket-highlight-danger",
    } in highlight_targets
