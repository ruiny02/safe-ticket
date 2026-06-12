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
    expect(html).toContain("Risk overview");
    expect(html).toContain("Top signals");
  });

  it("renders a reports index when no scan id is selected and shows the account footer", () => {
    const html = renderWithHash("#/reports");

    expect(html).toContain("Reports");
    expect(html).toContain("Recent reports");
    expect(html).toContain("safe-ticket");
    expect(html).toContain("Scan workspace");
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
});
