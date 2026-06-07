export type MarketplacePlatform = "joonggonara" | "bunjang";

export interface SellerInfo {
  seller_id: string;
  nickname: string;
  profile_url?: string | null;
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

export type UserTradeExperienceLevel = "beginner" | "intermediate" | "advanced";

export interface UserProfile {
  age: number | null;
  trade_experience_level: UserTradeExperienceLevel | null;
}

export interface ScanCreateRequest {
  platform: MarketplacePlatform;
  page_url: string;
  page_title: string;
  price: number;
  seller: SellerInfo;
  content_blocks: ContentBlock[];
  marketplace_signals: MarketplaceSignal[];
  user_profile?: UserProfile | null;
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
  matched_chunk?: string | null;
  risk_level?: "low" | "medium" | "high" | null;
  risk_flags?: string[];
}

export interface RiskScoreComponent {
  component: string;
  points: number;
  reason: string;
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
  risk_points?: number | null;
  embedding_risk_score?: number | null;
  risk_score_breakdown?: RiskScoreComponent[];
  summary: string | null;
  llm_reasoning?: string | null;
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
  user_profile?: UserProfile | null;
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

export type SellerContextLevel = "trusted" | "caution" | "high_risk" | "unknown";
export type PatternConsistency = "consistent" | "mixed" | "inconsistent" | "unknown";

export interface SellerProfileSnapshot {
  profile_url: string;
  seller_name: string | null;
  response_rate_percent: number | null;
  response_time: string | null;
  trust_index: number | null;
  safe_payment_count: number | null;
  review_count: number | null;
  follower_count: number | null;
  total_products: number | null;
  recent_product_titles: string[];
  raw_text_excerpt: string;
}

export interface SellerContextReportResponse {
  scan_id: string;
  profile_url: string;
  seller_name: string | null;
  seller_context_level: SellerContextLevel;
  seller_context_score: number;
  pattern_consistency: PatternConsistency;
  summary: string;
  positive_profile_signals: string[];
  current_listing_risk_signals: string[];
  pattern_shift_explanation: string;
  recommendation: string;
  profile_snapshot: SellerProfileSnapshot;
  source: "gemini" | "backend";
  model: string | null;
}

export type CaseUmapVariant = "current" | "fraud" | "safe" | "borderline";

export interface CaseUmapPoint {
  case_id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  x_3d: number | null;
  y_3d: number | null;
  z_3d: number | null;
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
    umap_dimensions: number[];
    umap_target: string | null;
    umap_target_metric: string | null;
    umap_target_weight: number | null;
  };
  current_scan: CaseUmapCurrentScan | null;
}

export type RiskMapLabel = "safe" | "borderline" | "fraud" | "current";
export type RiskMapMode = "embedding" | "final";

export interface RiskMapPoint {
  case_id: string;
  label: RiskMapLabel;
  score: number;
  x: number;
  y: number;
  z: number | null;
  embedding_risk_score: number;
  final_score_source: string;
  title: string | null;
  platform: string | null;
  summary: string | null;
}

export interface RiskMapResponse {
  model_version: string;
  projection_type: string;
  mode: RiskMapMode;
  score_aligned: boolean;
  x_axis: string;
  y_axis: string;
  z_axis: string | null;
  reducer: "pca" | "umap" | string;
  points: RiskMapPoint[];
  metrics: Record<string, unknown>;
  warnings: string[];
}
