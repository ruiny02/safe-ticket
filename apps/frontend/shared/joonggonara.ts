import type { ScanCreateRequest } from "./types";

const decodeJsonString = (value: string) => JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;

const cleanMultiline = (value: string) =>
  value.replace(/\\\\r\\\\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/\r\n/g, "\n").trim();

const matchOrThrow = (source: string, pattern: RegExp, fieldName: string) => {
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Failed to extract ${fieldName} from Joongna HTML`);
  }

  return match[1];
};

const extractProductDetailScript = (html: string) => {
  const scriptMatch = html.match(/self\.__next_f\.push\(\[1,"22:\[(.*?)<\/script>/s);
  if (!scriptMatch?.[1]) {
    return html;
  }

  return scriptMatch[1];
};

const fallbackMatch = (source: string, pattern: RegExp) => source.match(pattern)?.[1];

export function parseJoongnaProductHtml(html: string, pageUrl: string): ScanCreateRequest {
  const source = extractProductDetailScript(html);

  const pageTitle =
    fallbackMatch(source, /\\"productTitle\\":\\"([^]*?)\\",\\"productDescription\\"/) ??
    fallbackMatch(html, /<title>([^<]+?) \| 중고나라 - 안심되는 중고거래<\/title>/);
  const sellerId =
    fallbackMatch(source, /\\"storeSeq\\":(\d+)/) ??
    fallbackMatch(html, /href="\/store\/(\d+)"/);
  const sellerNickname =
    fallbackMatch(source, /\\"nickName\\":\\"([^]*?)\\",\\"productTitle\\"/) ??
    fallbackMatch(html, /text-gray-900">([^<]+)<\/span>/);
  const priceRaw =
    fallbackMatch(source, /\\"productPrice\\":(\d+)/) ??
    fallbackMatch(html, /"price":(\d+)/);
  const descriptionRaw =
    fallbackMatch(source, /\\"productDescription\\":\\"([^]*?)\\",\\"qty\\":/) ??
    fallbackMatch(
      html,
      /<p class="text-16 font-regular whitespace-pre-line break-all \[&amp;&gt;em\]:text-gray-400 \[&amp;&gt;em\]:not-italic max-md:text-14-reading">([^]*?)<\/p>/,
    );

  const decodedTitle = cleanMultiline(
    pageTitle?.includes('\\"') ? decodeJsonString(pageTitle) : pageTitle ?? matchOrThrow(html, /<title>([^<]+)<\/title>/, "page title"),
  );
  const decodedSellerNickname = cleanMultiline(
    sellerNickname?.includes('\\"') ? decodeJsonString(sellerNickname) : sellerNickname ?? matchOrThrow(html, /text-gray-900">([^<]+)<\/span>/, "seller nickname"),
  );
  const decodedDescription = cleanMultiline(
    descriptionRaw?.includes('\\"') || descriptionRaw?.includes("\\r\\n")
      ? decodeJsonString(descriptionRaw)
      : descriptionRaw ?? matchOrThrow(html, /<p[^>]*>([^]*?)<\/p>/, "description"),
  );

  if (!sellerId || !priceRaw) {
    throw new Error("Failed to extract seller id or price from Joongna HTML");
  }

  return {
    platform: "joonggonara",
    page_url: pageUrl,
    page_title: decodedTitle,
    price: Number(priceRaw),
    seller: {
      seller_id: sellerId,
      nickname: decodedSellerNickname,
    },
    content_blocks: [
      {
        block_id: "title",
        text: decodedTitle,
      },
      {
        block_id: "body-1",
        text: decodedDescription,
      },
    ],
  };
}

export function buildScanPayload(parsed: ScanCreateRequest): ScanCreateRequest {
  return parsed;
}
