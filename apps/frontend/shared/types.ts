export interface SellerInfo {
  seller_id: string;
  nickname: string;
}

export interface ContentBlock {
  block_id: string;
  text: string;
}

export interface ScanCreateRequest {
  platform: "joonggonara";
  page_url: string;
  page_title: string;
  price: number;
  seller: SellerInfo;
  content_blocks: ContentBlock[];
}

export interface ScanQueuedResponse {
  scan_id: string;
  status: "queued";
  poll_after_ms: number;
}
