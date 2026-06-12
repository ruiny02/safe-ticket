import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../App";

function renderWithHash(hash = "", search = "") {
  const previousWindow = (globalThis as { window?: Window }).window;

  (globalThis as { window?: Window }).window = {
    location: {
      hash,
      search,
    },
  } as unknown as Window;

  const html = renderToStaticMarkup(<App />);

  if (previousWindow) {
    (globalThis as { window?: Window }).window = previousWindow;
  } else {
    delete (globalThis as { window?: Window }).window;
  }

  return html;
}

describe("report page shell", () => {
  it("renders the main dashboard without the intelligence section or account footer", () => {
    const html = renderWithHash("#/dashboard");

    expect(html).toContain("Safety center");
    expect(html).toContain("Dashboard");
    expect(html).toContain("Reports");
    expect(html).toContain("Settings");
    expect(html).toContain("Pages");
    expect(html).not.toContain(">Main<");
    expect(html).not.toContain("Intelligence");
    expect(html).not.toContain("Scan workspace");
    expect(html).toContain("스캔 결과를 먼저 선택해 주세요");
    expect(html).toContain("확장 프로그램에서 스캔을 실행하면");
    expect(html).not.toContain("Risk overview");
    expect(html).not.toContain("Top signals");
  });

  it("renders a scan-first prompt in reports when no scan id is selected", () => {
    const html = renderWithHash("#/reports");

    expect(html).toContain("Reports");
    expect(html).toContain("스캔 결과를 먼저 선택해 주세요");
    expect(html).toContain("확장 프로그램에서 스캔을 실행하면");
    expect(html).toContain("safe-ticket");
    expect(html).toContain("Scan workspace");
    expect(html).not.toContain("Recent reports");
  });

  it("renders settings as user risk profile controls without demo login UI", () => {
    const html = renderWithHash("#/settings");

    expect(html).toContain("사용자 정보 설정");
    expect(html).toContain("자동 저장");
    expect(html).toContain("중고거래 경험");
    expect(html).toContain("입력한 나이와 거래 경험은 맞춤형 위험도 계산에 활용됩니다.");
    expect(html).not.toContain("Account & login");
    expect(html).not.toContain("회원가입");
    expect(html).not.toContain("데모용 로컬 로그인 상태");
    expect(html).not.toContain("로그인 필요 모드");
  });

  it("keeps the active scan id in sidebar links from settings", () => {
    const html = renderWithHash("#/settings?scanId=scan_65efe38f");

    expect(html).toContain('href="#/dashboard?scanId=scan_65efe38f"');
    expect(html).toContain('href="#/reports/scan_65efe38f"');
    expect(html).toContain('href="#/settings?scanId=scan_65efe38f"');
  });
});
