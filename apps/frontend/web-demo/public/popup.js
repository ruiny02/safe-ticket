const supportedPatterns = [
  /^https:\/\/web\.joongna\.com\/product\/[^/]+\/?$/,
  /^http:\/\/localhost:\d+\/product\/[^/]+\.html$/,
];
const LATEST_SCAN_STORAGE_KEY = "safeTicketLatestScan";

function buildReportPageUrl(scanId) {
  return `http://localhost:3000/report/#/report/${scanId}`;
}

function getReportPageUrlForTab(currentUrl, latestScan) {
  if (!latestScan) {
    return null;
  }

  if (latestScan.pageUrl !== currentUrl) {
    return null;
  }

  return buildReportPageUrl(latestScan.scanId);
}

function isSupportedJoongnaPage(url) {
  return supportedPatterns.some((pattern) => pattern.test(url));
}

function getStatus(url) {
  return isSupportedJoongnaPage(url)
    ? {
        supported: true,
        label: "이 페이지에서 스캔이 동작합니다.",
      }
    : {
        supported: false,
        label: "중고나라 상품 상세 페이지를 열면 패널이 자동으로 나타납니다.",
      };
}

async function run() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "활성 탭을 찾지 못했습니다.";
  const status = getStatus(url);

  const statusNode = document.getElementById("status");
  const currentUrlNode = document.getElementById("current-url");
  const openDemoButton = document.getElementById("open-demo");
  const openReportButton = document.getElementById("open-report");
  const storageApi = chrome.storage?.local;
  const stored = storageApi
    ? await storageApi.get(LATEST_SCAN_STORAGE_KEY)
    : {};
  const latestScan = stored[LATEST_SCAN_STORAGE_KEY] ?? null;
  const reportUrl = getReportPageUrlForTab(url, latestScan);

  statusNode.textContent = status.label;
  currentUrlNode.textContent = url;

  if (!status.supported) {
    statusNode.classList.add("is-inactive");
  }

  openDemoButton.addEventListener("click", async () => {
    await chrome.tabs.create({ url: "http://localhost:3000/product/227242032.html" });
  });

  if (!storageApi) {
    statusNode.classList.add("is-inactive");
    statusNode.textContent = "저장소 권한이 없어 최근 스캔 상태를 불러오지 못했습니다.";
    return;
  }

  if (reportUrl) {
    openReportButton.hidden = false;
    openReportButton.addEventListener("click", async () => {
      await chrome.tabs.create({ url: reportUrl });
    });
  }
}

void run();
