const supportedPatterns = [
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
  /^http:\/\/[^/?#]+:3000\/product\/[^/]+\.html$/i,
  /^http:\/\/[^/?#]+:3000\/joongna-chat\.html$/i,
  /^http:\/\/[^/?#]+:3000\/bunjang-chat\.html$/i,
];

const LATEST_SCAN_STORAGE_KEY = "safeTicketLatestScan";
const USER_PROFILE_STORAGE_KEY = "safeTicketUserProfile";
const DEFAULT_FRONTEND_BASE_URL = "http://localhost:3000";
const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"];

function getFrontendBaseUrl(currentUrl, latestScan = null) {
  if (latestScan?.frontendBaseUrl) {
    return latestScan.frontendBaseUrl.replace(/\/+$/, "");
  }

  try {
    const parsedUrl = new URL(currentUrl);
    const isSafeTicketFrontend =
      parsedUrl.protocol === "http:" &&
      (/^(?:localhost|127\.0\.0\.1)$/.test(parsedUrl.hostname) || parsedUrl.port === "3000");

    if (isSafeTicketFrontend) {
      return `${parsedUrl.protocol}//${parsedUrl.host}`;
    }
  } catch {
    // Fall back to the local compose frontend.
  }

  return DEFAULT_FRONTEND_BASE_URL;
}

function buildReportPageUrl(scanId, frontendBaseUrl) {
  return `${frontendBaseUrl}/report/#/reports/${encodeURIComponent(scanId)}`;
}

function getReportPageUrlForTab(currentUrl, latestScan) {
  if (!latestScan || latestScan.pageUrl !== currentUrl) {
    return null;
  }

  return buildReportPageUrl(latestScan.scanId, getFrontendBaseUrl(currentUrl, latestScan));
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
        label: "중고나라 또는 번개장터 상품 상세/채팅 페이지에서만 확장 패널이 나타납니다.",
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
  const openReportButton = document.getElementById("open-report");
  const ageInput = document.getElementById("age-input");
  const profileSaveStatus = document.getElementById("profile-save-status");
  const experienceButtons = Array.from(document.querySelectorAll("[data-experience]"));
  let latestScan = null;

  if (statusNode) {
    statusNode.textContent = status.label;
    if (!status.supported) {
      statusNode.hidden = false;
      statusNode.classList.add("is-inactive");
    }
  }

  if (currentUrlNode) {
    currentUrlNode.textContent = url;
  }

  const storageApi = chrome.storage?.local;
  if (!storageApi) {
    if (statusNode) {
      statusNode.classList.add("is-inactive");
      statusNode.textContent = "저장소 권한이 없어 사용자 설정과 최근 스캔 결과를 불러오지 못했습니다.";
    }
    return;
  }

  const stored = await storageApi.get([LATEST_SCAN_STORAGE_KEY, USER_PROFILE_STORAGE_KEY]);
  latestScan = stored[LATEST_SCAN_STORAGE_KEY] ?? null;
  const savedProfile = stored[USER_PROFILE_STORAGE_KEY] ?? null;
  const reportUrl = getReportPageUrlForTab(url, latestScan);

  if (savedProfile && typeof savedProfile === "object") {
    if (ageInput && typeof savedProfile.age === "number") {
      ageInput.value = String(savedProfile.age);
    }

    if (EXPERIENCE_LEVELS.includes(savedProfile.trade_experience_level)) {
      experienceButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.experience === savedProfile.trade_experience_level);
      });
    }
  }

  const setSaveStatus = (label, saved = false) => {
    if (!profileSaveStatus) {
      return;
    }

    profileSaveStatus.textContent = label;
    profileSaveStatus.classList.toggle("is-saved", saved);
  };

  const readCurrentProfile = () => {
    const ageValue = ageInput?.value?.trim() ?? "";
    const parsedAge = ageValue === "" ? null : Number.parseInt(ageValue, 10);
    const activeExperienceButton = experienceButtons.find((button) => button.classList.contains("is-active"));
    const tradeExperienceLevel = activeExperienceButton?.dataset.experience ?? null;

    return {
      age: Number.isFinite(parsedAge) ? parsedAge : null,
      trade_experience_level: EXPERIENCE_LEVELS.includes(tradeExperienceLevel) ? tradeExperienceLevel : null,
    };
  };

  const persistProfile = async () => {
    await storageApi.set({
      [USER_PROFILE_STORAGE_KEY]: readCurrentProfile(),
    });
    setSaveStatus("저장됨", true);
    window.setTimeout(() => {
      setSaveStatus("자동 저장", false);
    }, 1200);
  };

  ageInput?.addEventListener("change", () => {
    void persistProfile();
  });

  experienceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      experienceButtons.forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      void persistProfile();
    });
  });

  void reportUrl;
}

void run();
