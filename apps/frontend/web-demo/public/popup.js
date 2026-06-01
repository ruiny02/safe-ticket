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

function getReportPageUrlForTab(currentUrl, latestScan) {
  if (!latestScan || latestScan.pageUrl !== currentUrl) {
    return null;
  }

  return buildReportPageUrl(latestScan.scanId);
}

function isSupportedMarketplacePage(url) {
  return supportedPatterns.some((pattern) => pattern.test(url));
}

function getStatus(url) {
  return isSupportedMarketplacePage(url)
    ? {
        supported: true,
        label: "지원되는 페이지에서 safe-ticket 스캔이 동작합니다.",
      }
    : {
        supported: false,
        label: "중고나라 또는 번개장터 상품 상세/채팅 페이지를 열면 패널이 자동으로 나타납니다.",
      };
}

async function openTab(url) {
  await chrome.tabs.create({ url });
}

async function run() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "현재 탭 URL을 찾지 못했습니다.";
  const status = getStatus(url);

  const statusNode = document.getElementById("status");
  const currentUrlNode = document.getElementById("current-url");
  const openDemoButton = document.getElementById("open-demo");
  const openJoongnaChatDemoButton = document.getElementById("open-joongna-chat-demo");
  const openBunjangChatDemoButton = document.getElementById("open-bunjang-chat-demo");
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

  openDemoButton?.addEventListener("click", () => {
    void openTab("http://localhost:3000/product/227242032.html");
  });

  openJoongnaChatDemoButton?.addEventListener("click", () => {
    void openTab("http://localhost:3000/joongna-chat.html");
  });

  openBunjangChatDemoButton?.addEventListener("click", () => {
    void openTab("http://localhost:3000/bunjang-chat.html");
  });

  const storageApi = chrome.storage?.local;
  if (!storageApi) {
    if (statusNode) {
      statusNode.classList.add("is-inactive");
      statusNode.textContent = "저장소 권한이 없어 최근 스캔 상태를 불러오지 못했습니다.";
    }
    return;
  }

  const stored = await storageApi.get(LATEST_SCAN_STORAGE_KEY);
  const latestScan = stored[LATEST_SCAN_STORAGE_KEY] ?? null;
  const reportUrl = getReportPageUrlForTab(url, latestScan);

  if (openReportButton && reportUrl) {
    openReportButton.hidden = false;
    openReportButton.addEventListener("click", () => {
      void openTab(reportUrl);
    });
  }
}

void run();
