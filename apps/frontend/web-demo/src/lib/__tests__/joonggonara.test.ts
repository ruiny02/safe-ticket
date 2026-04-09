import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildScanPayload, parseJoongnaProductHtml } from "../../../../shared/joonggonara";

const currentDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const fixturePath = resolve(
  currentDir,
  "../../../../../frontend/demo/joongna-product-demo/product/227242032.html",
);

describe("parseJoongnaProductHtml", () => {
  it("extracts the demo product fields from joongna html", () => {
    const html = readFileSync(fixturePath, "utf-8");

    const parsed = parseJoongnaProductHtml(
      html,
      "http://localhost:3000/joongna-product-demo/product/227242032.html",
    );

    expect(parsed.platform).toBe("joonggonara");
    expect(parsed.page_title).toBe("tuki. 츠키 아시아투어콘서트 정가*~-");
    expect(parsed.price).toBe(163000);
    expect(parsed.seller).toEqual({
      seller_id: "4099087",
      nickname: "낭닥SJ",
    });
    expect(parsed.content_blocks[0]).toEqual({
      block_id: "title",
      text: "tuki. 츠키 아시아투어콘서트 정가*~-",
    });
    expect(parsed.content_blocks[1].block_id).toBe("body-1");
    expect(parsed.content_blocks[1].text).toContain("계좌 번호 : 3355-28-8620726");
    expect(parsed.content_blocks[1].text).not.toContain("\\r\\n");
  });
});

describe("buildScanPayload", () => {
  it("keeps the scan contract shape expected by POST /api/v1/scans", () => {
    const html = readFileSync(fixturePath, "utf-8");
    const parsed = parseJoongnaProductHtml(html, "https://example.com/post/123");

    expect(buildScanPayload(parsed)).toEqual({
      platform: "joonggonara",
      page_url: "https://example.com/post/123",
      page_title: "tuki. 츠키 아시아투어콘서트 정가*~-",
      price: 163000,
      seller: {
        seller_id: "4099087",
        nickname: "낭닥SJ",
      },
      content_blocks: [
        {
          block_id: "title",
          text: "tuki. 츠키 아시아투어콘서트 정가*~-",
        },
        {
          block_id: "body-1",
          text: expect.stringContaining("입금 은행 : 카카오뱅크"),
        },
      ],
    });
  });
});
