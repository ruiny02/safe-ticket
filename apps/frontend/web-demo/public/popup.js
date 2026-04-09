const supportedPatterns = [
  /^https:\/\/web\.joongna\.com\/product\/[^/]+\/?$/,
  /^http:\/\/localhost:\d+\/product\/[^/]+\.html$/,
];

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

  statusNode.textContent = status.label;
  currentUrlNode.textContent = url;

  if (!status.supported) {
    statusNode.classList.add("is-inactive");
  }

  openDemoButton.addEventListener("click", async () => {
    await chrome.tabs.create({ url: "http://localhost:3000/product/227242032.html" });
  });
}

void run();
