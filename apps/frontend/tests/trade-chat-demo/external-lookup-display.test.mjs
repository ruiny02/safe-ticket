import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const display = require("../../trade-chat-demo/safe-ticket-external-lookup-display.js");

test("buildExternalLookupRows formats account lookup results for the chat extension panel", () => {
  const rows = display.buildExternalLookupRows([
    {
      provider: "police",
      kind: "account",
      keyword: "3020264877711",
      status: "completed",
      message: "경찰청 기준 최근 3개월 내 3건 이상 신고된 이력은 확인되지 않았습니다.",
      risk_found: false,
    },
    {
      provider: "thecheat",
      kind: "account",
      keyword: "3020264877711",
      status: "login_required",
      message: "더치트 조회는 로그인 또는 앱 OTP 인증이 필요합니다.",
      risk_found: null,
    },
  ]);

  assert.deepEqual(rows, [
    {
      title: "경찰청 사이버사기 조회 · 계좌번호",
      keyword: "3020-26-4877711",
      statusLabel: "신고 이력 없음",
      message: "경찰청 기준 최근 3개월 내 3건 이상 신고된 이력은 확인되지 않았습니다.",
      tone: "ok",
    },
    {
      title: "더치트 피해사례 조회 · 계좌번호",
      keyword: "3020-26-4877711",
      statusLabel: "로그인 필요",
      message: "더치트 조회는 로그인 또는 앱 OTP 인증이 필요합니다.",
      tone: "warning",
    },
  ]);
});

test("buildExternalLookupRows marks risky and failed lookups as danger", () => {
  const rows = display.buildExternalLookupRows([
    {
      provider: "thecheat",
      kind: "phone",
      keyword: "01041120302",
      status: "completed",
      message: "더치트 공개 검색 결과에서 피해사례가 확인되었습니다.",
      risk_found: true,
    },
    {
      provider: "police",
      kind: "phone",
      keyword: "01041120302",
      status: "failed",
      message: "외부조회 처리 중 오류가 발생했습니다.",
      risk_found: null,
    },
  ]);

  assert.equal(rows[0].keyword, "010-4112-0302");
  assert.equal(rows[0].statusLabel, "위험 이력 확인");
  assert.equal(rows[0].tone, "danger");
  assert.equal(rows[1].statusLabel, "조회 실패");
  assert.equal(rows[1].tone, "danger");
});
