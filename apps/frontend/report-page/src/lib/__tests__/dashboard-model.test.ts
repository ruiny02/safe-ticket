import { describe, expect, it } from "vitest";

import type { PipelineExchangeResponse, RiskMapResponse, ScanResultResponse } from "../../../../shared/types";
import { buildDashboardModel } from "../dashboard-model";

const scanResult: ScanResultResponse = {
  scan_id: "scan_1234abcd",
  status: "completed",
  risk_level: "high",
  risk_score: 0.91,
  summary: "계좌 패턴과 선입금 유도 표현이 함께 감지되었습니다.",
  risk_tags: ["bank_account_pattern", "avoid_safe_payment"],
  evidence_items: [],
  highlight_targets: [
    {
      block_id: "body-1",
      start: 8,
      end: 13,
      matched_text: "카카오뱅크",
      reason_code: "bank_name_detected",
      reason: "모니터링 대상 은행명입니다.",
      css_class: "safe-ticket-highlight-danger",
    },
    {
      block_id: "body-1",
      start: 22,
      end: 37,
      matched_text: "3355-28-8620726",
      reason_code: "bank_account_pattern",
      reason: "적금통장 패턴과 유사합니다.",
      css_class: "safe-ticket-highlight-danger",
    },
  ],
  similar_cases: [
    {
      case_id: "case_11",
      score: 0.88,
      summary: "외부 메신저로 이동 후 선입금을 요구한 사례",
    },
    {
      case_id: "case_21",
      score: 0.76,
      summary: "은행 계좌를 두 번 바꿔서 입금을 요구한 사례",
    },
  ],
  recommended_actions: [
    {
      action: "계좌 재확인",
      description: "예금주, 은행명, 계좌번호를 다시 확인하세요.",
    },
    {
      action: "추가 입금 중단",
      description: "추가 송금 요청이 오면 바로 거래를 중단하세요.",
    },
  ],
  external_lookup_results: [
    {
      provider: "police",
      kind: "account",
      keyword: "3355288620726",
      status: "completed",
      message: "경찰청 사이버범죄 신고시스템 기준 최근 3개월 내 3건 이상 신고된 이력은 확인되지 않았습니다.",
      source_url: "https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
      report_count: 0,
      risk_found: false,
      result_text: null,
    },
    {
      provider: "thecheat",
      kind: "account",
      keyword: "3355288620726",
      status: "login_required",
      message: "더치트 조회는 로그인 또는 앱 OTP 인증이 필요합니다.",
      source_url: "https://thecheat.co.kr/rb/?mod=ssl_login_otp",
      report_count: null,
      risk_found: null,
      result_text: "로그인이 필요합니다.",
    },
    {
      provider: "police",
      kind: "phone",
      keyword: "01041120302",
      status: "completed",
      message: "경찰청 사이버범죄 신고시스템 기준 최근 3개월 내 3건 이상 신고된 이력은 확인되지 않았습니다.",
      source_url: "https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
      report_count: 0,
      risk_found: false,
      result_text: null,
    },
  ],
  degraded: false,
  report_url: "/report/scan_1234abcd",
};

const pipelineDebug: PipelineExchangeResponse = {
  scan_id: "scan_1234abcd",
  outbound_payload: {
    scan_id: "scan_1234abcd",
    platform: "joonggonara",
    page_url: "http://localhost:3000/product/227242032.html",
    page_title: "tuki. 츠키 아시아투어콘서트 정가*~-",
    price: 163000,
    seller: {
      seller_id: "4099087",
      nickname: "낭닥SJ",
    },
    content_blocks: [
      {
        block_id: "body-1",
        text: "입금 은행 : 카카오뱅크\n계좌 번호 : 3355-28-8620726",
      },
    ],
    marketplace_signals: [],
  },
  inbound_payload: {
    risk_level: "high",
    risk_score: 0.91,
    summary: "계좌 패턴과 선입금 유도 표현이 함께 감지되었습니다.",
    risk_tags: ["bank_account_pattern", "avoid_safe_payment"],
    evidence_items: [],
    highlight_targets: [],
    similar_cases: [],
    recommended_actions: [],
    degraded: false,
  },
};

describe("buildDashboardModel", () => {
  it("builds a report-page dashboard model with consolidated overview and seller observation", () => {
    const model = buildDashboardModel({
      scanResult,
      pipelineDebug,
      caseUmap: null,
    });

    expect(model.hero.title).toContain("즉시 거래를 멈추고");
    expect(model.overview.label).toBe("Risk overview");
    expect(model.overview.items.map((item) => item.label)).toEqual([
      "Scan quality",
      "Flagged text",
      "Similar cases",
    ]);
    expect(model.overview.items.map((item) => item.value)).toEqual(["91점", "2", "2"]);
    expect(model.overview.items[1].detail).toBe("원문에서 backend가 위험 근거로 표시한 문구 수");
    expect(model.overview.items[2].detail).toBe("RAG 검색으로 연결된 유사 거래 사례 수");
    expect(model.embedding.title).toBe("Risk-map 좌표 로딩 중");
    expect(model.embedding.description).toContain("backend risk-map에서 실제 DB 임베딩 좌표를 가져오고 있습니다");
    expect(model.embedding.pipeline).toBe("waiting for backend risk-map");
    expect(model.embedding.points).toEqual([]);
    expect(model.embedding.summary.nearestCluster).toBe("fraud");
    expect(model.embedding.summary.clusterCounts).toEqual({
      fraud: 0,
      safe: 0,
      borderline: 0,
    });
    expect(model.sellerObservation).toEqual({
      sellerName: "낭닥SJ",
      primaryAlias: "낭닥SJ",
      accountNumber: "3355-28-8620726",
      recentFraudCases: 2,
      observedAliases: ["낭닥SJ"],
      listingTitle: "tuki. 츠키 아시아투어콘서트 정가*~-",
      priceText: "163,000원",
      trustSignals: [],
    });
    expect(model.externalLookups).toEqual([
      {
        title: "경찰청 사이버사기 조회 · 계좌번호",
        keyword: "3355-28-8620726",
        statusLabel: "신고 이력 없음",
        message: "경찰청 사이버범죄 신고시스템 기준 최근 3개월 내 3건 이상 신고된 이력은 확인되지 않았습니다.",
        tone: "ok",
        sourceUrl: "https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
      },
      {
        title: "더치트 피해사례 조회 · 계좌번호",
        keyword: "3355-28-8620726",
        statusLabel: "로그인 필요",
        message: "더치트 조회는 로그인 또는 앱 OTP 인증이 필요합니다.",
        tone: "warning",
        sourceUrl: "https://thecheat.co.kr/rb/?mod=ssl_login_otp",
      },
      {
        title: "경찰청 사이버사기 조회 · 전화번호",
        keyword: "010-4112-0302",
        statusLabel: "신고 이력 없음",
        message: "경찰청 사이버범죄 신고시스템 기준 최근 3개월 내 3건 이상 신고된 이력은 확인되지 않았습니다.",
        tone: "ok",
        sourceUrl: "https://www.police.go.kr/www/security/cyber/cyber04.jsp#none",
      },
    ]);
    expect(model.lookupLinks.map((link) => link.label)).toEqual(["경찰청 조회 안내", "더치트 조회"]);
  });

  it("uses backend case UMAP data when it is available", () => {
    const model = buildDashboardModel({
      scanResult,
      pipelineDebug,
      caseUmap: {
        points: [
          {
            case_id: "case_high",
            label: "High risk ticket post",
            x: 20,
            y: 30,
            z: 42,
            x_3d: 21,
            y_3d: 32,
            z_3d: 44,
            variant: "fraud",
            risk_level: "high",
            risk_score: 0.9,
            summary: "high risk",
            source_url: "https://example.com/high",
            platform_hint: "joonggonara",
            risk_flags: ["payment_flow_high_risk"],
          },
          {
            case_id: "case_low",
            label: "Low risk ticket post",
            x: 80,
            y: 70,
            z: 64,
            x_3d: 81,
            y_3d: 72,
            z_3d: 66,
            variant: "safe",
            risk_level: "low",
            risk_score: 0.1,
            summary: "low risk",
            source_url: "https://example.com/low",
            platform_hint: "bunjang",
            risk_flags: [],
          },
          {
            case_id: "scan_1234abcd",
            label: "현재 scan",
            x: 22,
            y: 31,
            z: 43,
            x_3d: 23,
            y_3d: 33,
            z_3d: 45,
            variant: "current",
            risk_level: null,
            risk_score: null,
            summary: "current",
            source_url: null,
            platform_hint: null,
            risk_flags: [],
          },
        ],
        total_cases: 2,
        risk_counts: {
          fraud: 1,
          safe: 1,
          borderline: 0,
        },
        projection: {
          pipeline: "case_chunks.embedding mean -> PCA(<=50) -> Supervised UMAP(2) + Supervised UMAP(3)",
          source_embedding: "case_chunks.embedding",
          pca_components: 4,
          umap_neighbors: null,
          umap_min_dist: null,
          umap_dimensions: [2, 3],
          umap_target: "risk_score_ordinal",
          umap_target_metric: "l2",
          umap_target_weight: 0.25,
        },
        current_scan: {
          scan_id: "scan_1234abcd",
          nearest_cluster: "fraud",
          distances: {
            fraud: 2.2,
            safe: 40,
            borderline: 18,
          },
        },
      },
    });

    expect(model.embedding.pipeline).toBe("case_chunks.embedding mean -> PCA(<=50) -> Supervised UMAP(2) + Supervised UMAP(3)");
    expect(model.embedding.points).toHaveLength(3);
    expect(model.embedding.points[0]).toEqual({
      id: "case_high",
      label: "High risk ticket post",
      x: 20,
      y: 30,
      z: 42,
      x3d: 21,
      y3d: 32,
      z3d: 44,
      variant: "fraud",
    });
    expect(model.embedding.summary).toEqual({
      nearestCluster: "fraud",
      clusterCounts: {
        fraud: 1,
        safe: 1,
        borderline: 0,
      },
      distances: {
        fraud: 2.2,
        safe: 40,
        borderline: 18,
      },
    });
  });

  it("uses backend risk-map UMAP data when it is available", () => {
    const riskMap: RiskMapResponse = {
      model_version: "risk_space_pls_v1_test",
      projection_type: "pls1_semantic_residual_umap_v1",
      mode: "embedding",
      score_aligned: false,
      x_axis: "calibrated_pls1_risk_axis",
      y_axis: "semantic_residual_umap_component_1",
      z_axis: "semantic_residual_umap_component_2",
      reducer: "umap",
      metrics: {},
      warnings: [],
      points: [
        {
          case_id: "risk_case_high",
          label: "fraud",
          score: 0.88,
          x: 88,
          y: 22,
          z: 40,
          embedding_risk_score: 0.88,
          final_score_source: "embedding_score",
          title: "Risk map high",
          platform: "joonggonara",
          summary: "risk map high summary",
        },
        {
          case_id: "risk_case_safe",
          label: "safe",
          score: 0.08,
          x: 12,
          y: 72,
          z: 61,
          embedding_risk_score: 0.08,
          final_score_source: "embedding_score",
          title: "Risk map safe",
          platform: "joonggonara",
          summary: "risk map safe summary",
        },
        {
          case_id: "scan_1234abcd",
          label: "current",
          score: 0.57,
          x: 57,
          y: 46,
          z: 52,
          embedding_risk_score: 0.57,
          final_score_source: "scan_embedding_score",
          title: "Current scan",
          platform: "joonggonara",
          summary: "current scan summary",
        },
      ],
    };

    const model = buildDashboardModel({
      scanResult,
      pipelineDebug,
      caseUmap: null,
      caseRiskMap: riskMap,
    });

    expect(model.embedding.title).toBe("Risk-axis semantic map");
    expect(model.embedding.pipeline).toBe("raw embedding -> PLS1 risk axis + semantic residual UMAP(2/3)");
    expect(model.embedding.points).toEqual([
      {
        id: "risk_case_high",
        label: "Risk map high",
        x: 88,
        y: 22,
        z: 40,
        x3d: 88,
        y3d: 22,
        z3d: 40,
        variant: "fraud",
        riskScore: 0.88,
      },
      {
        id: "risk_case_safe",
        label: "Risk map safe",
        x: 12,
        y: 72,
        z: 61,
        x3d: 12,
        y3d: 72,
        z3d: 61,
        variant: "safe",
        riskScore: 0.08,
      },
      {
        id: "scan_1234abcd",
        label: "Current scan",
        x: 57,
        y: 46,
        z: 52,
        x3d: 57,
        y3d: 46,
        z3d: 52,
        variant: "current",
        riskScore: 0.57,
      },
    ]);
  });
});
