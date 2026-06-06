export type MarketplacePlatform = "joonggonara" | "bunjang";

export interface SellerInfo {
  seller_id: string;
  nickname: string;
}

export interface ContentBlock {
  block_id: string;
  text: string;
}

export interface MarketplaceSignal {
  key: string;
  label: string;
  value: string;
}

export interface ScanCreateRequest {
  platform: MarketplacePlatform;
  page_url: string;
  page_title: string;
  price: number;
  seller: SellerInfo;
  content_blocks: ContentBlock[];
  marketplace_signals: MarketplaceSignal[];
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

export interface ExternalLookupResult {
  provider: "police" | "thecheat";
  kind: "phone" | "account";
  keyword: string;
  status: "completed" | "login_required" | "failed";
  message: string;
  source_url: string;
  report_count: number | null;
  risk_found: boolean | null;
  result_text: string | null;
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
  external_lookup_results?: ExternalLookupResult[];
  degraded: boolean;
  report_url: string | null;
}

export interface PipelineOutboundPayload {
  scan_id: string;
  platform: string;
  page_url: string;
  page_title: string;
  price: number;
  seller: SellerInfo;
  content_blocks: ContentBlock[];
  marketplace_signals: MarketplaceSignal[];
}

export interface PipelineInboundPayload {
  risk_level: "low" | "medium" | "high";
  risk_score: number;
  summary: string;
  risk_tags: string[];
  evidence_items: ScanHighlightTarget[];
  highlight_targets: ScanHighlightTarget[];
  similar_cases: SimilarCase[];
  recommended_actions: RecommendedAction[];
  degraded: boolean;
}

export interface PipelineExchangeResponse {
  scan_id: string;
  outbound_payload: PipelineOutboundPayload;
  inbound_payload: PipelineInboundPayload;
}

export type CaseUmapVariant = "current" | "fraud" | "safe" | "borderline";

export interface CaseUmapPoint {
  case_id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  variant: CaseUmapVariant;
  risk_level: "low" | "medium" | "high" | null;
  risk_score: number | null;
  summary: string | null;
  source_url: string | null;
  platform_hint: string | null;
  risk_flags: string[];
}

export interface CaseUmapCurrentScan {
  scan_id: string;
  nearest_cluster: "fraud" | "safe" | "borderline";
  distances: Partial<Record<"fraud" | "safe" | "borderline", number>>;
}

export interface CaseUmapResponse {
  points: CaseUmapPoint[];
  total_cases: number;
  risk_counts: Partial<Record<"fraud" | "safe" | "borderline", number>>;
  projection: {
    pipeline: string;
    source_embedding: string;
    pca_components: number;
    umap_neighbors: number | null;
    umap_min_dist: number | null;
  };
  current_scan: CaseUmapCurrentScan | null;
}
