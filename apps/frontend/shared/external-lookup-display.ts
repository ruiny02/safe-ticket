import type { ExternalLookupResult } from "./types";

export function externalLookupProviderLabel(provider: ExternalLookupResult["provider"]): string {
  return provider === "police" ? "경찰청 사이버사기 조회" : "더치트 피해사례 조회";
}

export function externalLookupKindLabel(kind: ExternalLookupResult["kind"]): string {
  return kind === "account" ? "계좌번호" : "전화번호";
}

export function externalLookupTitle(result: ExternalLookupResult): string {
  return `${externalLookupProviderLabel(result.provider)} · ${externalLookupKindLabel(result.kind)}`;
}

export function externalLookupStatusLabel(result: ExternalLookupResult): string {
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

export function formatExternalLookupKeyword(result: ExternalLookupResult): string {
  const digits = result.keyword.replace(/\D/g, "");

  if (result.kind === "phone" && digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (result.kind === "account" && digits.length === 13) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  }

  return result.keyword;
}
