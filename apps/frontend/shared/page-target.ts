const SUPPORTED_PATTERNS = [
  /^https:\/\/(?:web|m)\.joongna\.com\/.*(?:product|products|item|articles?)\/[^/?#]+\/?(?:\?.*)?$/i,
  /^https:\/\/web\.joongna\.com\/product\/[^/?#]+\/?(?:\?.*)?$/i,
  /^https:\/\/(?:web|m)\.joongna\.com\/.*(?:chat|message|talk).*(?:\?.*)?$/i,
  /^https:\/\/m\.bunjang\.co\.kr\/products\/[^/?#]+\/?(?:\?.*)?$/i,
  /^https:\/\/m\.bunjang\.co\.kr\/.*(?:talk|chat|message).*(?:\?.*)?$/i,
  /^http:\/\/localhost:\d+\/product\/[^/]+\.html$/i,
  /^http:\/\/localhost:\d+\/joongna-chat\.html$/i,
  /^http:\/\/localhost:\d+\/bunjang-chat\.html$/i,
  /^http:\/\/127\.0\.0\.1:\d+\/product\/[^/]+\.html$/i,
  /^http:\/\/127\.0\.0\.1:\d+\/joongna-chat\.html$/i,
  /^http:\/\/127\.0\.0\.1:\d+\/bunjang-chat\.html$/i,
  /^http:\/\/54\.180\.226\.121:\d+\/product\/[^/]+\.html$/i,
  /^http:\/\/54\.180\.226\.121:\d+\/joongna-chat\.html$/i,
  /^http:\/\/54\.180\.226\.121:\d+\/bunjang-chat\.html$/i,
];

export function isSupportedMarketplacePage(url: string): boolean {
  return SUPPORTED_PATTERNS.some((pattern) => pattern.test(url));
}

export function getSupportedMarketplacePageStatus(url: string): {
  supported: boolean;
  label: string;
} {
  const supported = isSupportedMarketplacePage(url);

  return supported
    ? {
        supported: true,
        label: "지원되는 페이지에서 패널이 동작하고 있습니다.",
      }
    : {
        supported: false,
        label: "중고나라 또는 번개장터 상품 상세/채팅 페이지를 열면 패널이 자동으로 나타납니다.",
      };
}

export const isSupportedJoongnaPage = isSupportedMarketplacePage;
export const getSupportedJoongnaPageStatus = getSupportedMarketplacePageStatus;
export const isSupportedSafeTicketPage = isSupportedMarketplacePage;
export const getSupportedSafeTicketPageStatus = getSupportedMarketplacePageStatus;
