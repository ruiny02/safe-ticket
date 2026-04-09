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

export interface ScanHighlightTarget {
  block_id: string;
  start: number;
  end: number;
  matched_text: string;
  reason_code: string;
  reason: string;
  css_class: string;
}

export interface RecommendedAction {
  action: string;
  description: string;
}

export interface SimilarCase {
  case_id: string;
  score: number;
  summary: string;
}

export interface ScanResultResponse {
  scan_id: string;
  status: "queued" | "processing" | "completed" | "partial" | "failed";
  risk_level: "low" | "medium" | "high" | null;
  risk_score: number | null;
  summary: string | null;
  risk_tags: string[];
  evidence_items: ScanHighlightTarget[];
  highlight_targets: ScanHighlightTarget[];
  similar_cases: SimilarCase[];
  recommended_actions: RecommendedAction[];
  degraded: boolean;
  report_url: string | null;
}
