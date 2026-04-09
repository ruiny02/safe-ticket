from typing import Literal

from pydantic import BaseModel, Field


class SellerInfo(BaseModel):
    seller_id: str = Field(min_length=1)
    nickname: str = Field(min_length=1)


class ContentBlock(BaseModel):
    block_id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class ScanCreateRequest(BaseModel):
    platform: Literal["joonggonara"]
    page_url: str = Field(min_length=1)
    page_title: str = Field(min_length=1)
    price: int = Field(gt=0)
    seller: SellerInfo
    content_blocks: list[ContentBlock] = Field(min_length=1)


class ScanQueuedResponse(BaseModel):
    scan_id: str
    status: Literal["queued"]
    poll_after_ms: int
