const SUPPORTED_PATTERNS = [
  /^https:\/\/web\.joongna\.com\/product\/[^/]+\/?$/,
  /^http:\/\/localhost:\d+\/product\/[^/]+\.html$/,
];

export function isSupportedJoongnaPage(url: string): boolean {
  return SUPPORTED_PATTERNS.some((pattern) => pattern.test(url));
}

export function getSupportedJoongnaPageStatus(url: string): {
  supported: boolean;
  label: string;
} {
  const supported = isSupportedJoongnaPage(url);

  return supported
    ? {
        supported: true,
        label: "이 페이지에서 스캔이 동작합니다.",
      }
    : {
        supported: false,
        label: "중고나라 상품 상세 페이지를 열면 패널이 자동으로 나타납니다.",
      };
}
