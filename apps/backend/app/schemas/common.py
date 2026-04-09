"""Common reusable response schemas."""

from pydantic import BaseModel


class MessageResponse(BaseModel):
    """Simple status message returned by small mutation endpoints."""

    # The status field mirrors the repo docs for feedback responses.
    status: str
