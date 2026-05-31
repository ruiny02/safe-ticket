(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SafeTicketExternalLookupDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  function providerLabel(provider) {
    return provider === "police" ? "경찰청 사이버사기 조회" : "더치트 피해사례 조회";
  }

  function kindLabel(kind) {
    return kind === "account" ? "계좌번호" : "전화번호";
  }

  function title(result) {
    return `${providerLabel(result.provider)} · ${kindLabel(result.kind)}`;
  }

  function statusLabel(result) {
    if (result.status === "failed") {
      return "조회 실패";
    }

    if (result.status === "login_required") {
      return "로그인 필요";
    }

    if (result.risk_found === true) {
      return "위험 이력 확인";
    }

    if (result.risk_found === false) {
      return "신고 이력 없음";
    }

    return "조회 완료";
  }

  function tone(result) {
    if (result.status === "failed" || result.risk_found === true) {
      return "danger";
    }

    if (result.status === "login_required") {
      return "warning";
    }

    return "ok";
  }

  function formatKeyword(result) {
    const digits = String(result.keyword ?? "").replace(/\D/g, "");

    if (result.kind === "phone" && digits.length === 11) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }

    if (result.kind === "account" && digits.length === 13) {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
    }

    return result.keyword ?? "";
  }

  function buildExternalLookupRows(results) {
    return (results ?? []).slice(0, 6).map((result) => ({
      title: title(result),
      keyword: formatKeyword(result),
      statusLabel: statusLabel(result),
      message: result.message,
      tone: tone(result),
    }));
  }

  return {
    buildExternalLookupRows,
    formatKeyword,
    kindLabel,
    providerLabel,
    statusLabel,
    title,
    tone,
  };
});
