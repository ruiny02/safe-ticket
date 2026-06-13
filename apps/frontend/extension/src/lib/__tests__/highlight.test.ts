import { describe, expect, it } from "vitest";

import { extractHighlightTargets } from "../highlight";
import type { ScanResultResponse } from "../../../../shared/types";

describe("extractHighlightTargets", () => {
  it("keeps only the completed scan markers needed for DOM highlighting", () => {
    const result: ScanResultResponse = {
      scan_id: "scan_123",
      status: "completed",
      risk_level: "high",
      risk_score: 0.87,
      summary: "dummy",
      risk_tags: ["avoid_safe_payment"],
      evidence_items: [],
      similar_cases: [],
      recommended_actions: [],
      degraded: false,
      report_url: "/report/scan_123",
      highlight_targets: [
        {
          block_id: "body-1",
          start: 15,
          end: 24,
          matched_text: "messenger",
          reason_code: "off_platform_contact",
          reason: "The listing tries to move the conversation off-platform.",
          css_class: "safe-ticket-highlight-danger",
        },
      ],
    };

    expect(extractHighlightTargets(result)).toEqual([
      {
        blockId: "body-1",
        matchedText: "messenger",
        cssClass: "safe-ticket-highlight-danger",
        reasonCode: "off_platform_contact",
      },
    ]);
  });

  it("returns nothing before the scan completes", () => {
    const result: ScanResultResponse = {
      scan_id: "scan_123",
      status: "processing",
      risk_level: null,
      risk_score: null,
      summary: null,
      risk_tags: [],
      evidence_items: [],
      similar_cases: [],
      recommended_actions: [],
      degraded: false,
      report_url: null,
      highlight_targets: [],
    };

    expect(extractHighlightTargets(result)).toEqual([]);
  });
});
