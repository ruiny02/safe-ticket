const supportedPatterns = [
  /^https:\/\/web\.joongna\.com\/product\/[^/?#]+\/?(?:\?.*)?$/i,
  /^https:\/\/web\.joongna\.com\/.*(?:chat|message).*(?:\?.*)?$/i,
  /^https:\/\/m\.bunjang\.co\.kr\/products\/[^/?#]+\/?(?:\?.*)?$/i,
  /^https:\/\/m\.bunjang\.co\.kr\/.*(?:talk|chat|message).*(?:\?.*)?$/i,
  /^http:\/\/localhost:\d+\/product\/[^/]+\.html$/i,
  /^http:\/\/localhost:\d+\/joongna-chat\.html$/i,
  /^http:\/\/localhost:\d+\/bunjang-chat\.html$/i,
  /^http:\/\/127\.0\.0\.1:\d+\/product\/[^/]+\.html$/i,
  /^http:\/\/127\.0\.0\.1:\d+\/joongna-chat\.html$/i,
  /^http:\/\/127\.0\.0\.1:\d+\/bunjang-chat\.html$/i,
];

const LATEST_SCAN_STORAGE_KEY = "safeTicketLatestScan";

function buildReportPageUrl(scanId) {
  return `http://localhost:3000/report/#/reports/${encodeURIComponent(scanId)}`;
}

function isSupportedMarketplacePage(url) {
  return supportedPatterns.some((pattern) => pattern.test(url));
}

function getStatus(url) {
  return isSupportedMarketplacePage(url)
    ? {
        supported: true,
        label: "지원되는 페이지에서 패널이 동작하고 있습니다.",
      }
    : {
        supported: false,
        label: "중고나라 또는 번개장터 상품 상세/채팅 페이지를 열면 패널이 자동으로 나타납니다.",
      };
}

function getReportPageUrlForTab(currentUrl, latestScan) {
  if (!latestScan || latestScan.pageUrl !== currentUrl) {
    return null;
  }

  return buildReportPageUrl(latestScan.scanId);
}

async function run() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "현재 탭 URL을 찾지 못했습니다.";
  const status = getStatus(url);
  const statusNode = document.getElementById("status");
  const currentUrlNode = document.getElementById("current-url");
  const openDemoButton = document.getElementById("open-demo");
  const openReportButton = document.getElementById("open-report");

  if (statusNode) {
    statusNode.textContent = status.label;
    if (!status.supported) {
      statusNode.classList.add("is-inactive");
    }
  }

  if (currentUrlNode) {
    currentUrlNode.textContent = url;
  }

  if (openDemoButton) {
    openDemoButton.hidden = true;
  }

  const storageApi = chrome.storage?.local;
  if (!storageApi) {
    return;
  }

  const stored = await storageApi.get(LATEST_SCAN_STORAGE_KEY);
  const latestScan = stored[LATEST_SCAN_STORAGE_KEY] ?? null;
  const reportUrl = getReportPageUrlForTab(url, latestScan);

  if (openReportButton && reportUrl) {
    openReportButton.hidden = false;
    openReportButton.addEventListener("click", async () => {
      await chrome.tabs.create({ url: reportUrl });
    });
  }
}

void run();
