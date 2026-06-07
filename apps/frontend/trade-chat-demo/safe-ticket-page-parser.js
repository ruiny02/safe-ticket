
(function () {
  const PARSER_VERSION = "0.1.0";
  const CHAT_ROOT_SELECTOR = "[data-safe-ticket-chat]";
  const CHAT_MESSAGE_SELECTOR = "[data-chat-message]";

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getText(selector, root = document) {
    return normalizeText(root.querySelector(selector)?.textContent);
  }

  function parseMoney(value) {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }

  function getPageUrl(platform) {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return window.location.href;
    }

    return `http://54.180.226.121:3000/${platform}-chat.html`;
  }

  function inferPlatform(root) {
    if (root?.dataset.platform) {
      return root.dataset.platform;
    }

    const hostAndPath = `${window.location.hostname} ${window.location.pathname}`.toLowerCase();
    if (hostAndPath.includes("bunjang")) {
      return "bunjang";
    }
    if (hostAndPath.includes("joongna") || hostAndPath.includes("joonggonara")) {
      return "joonggonara";
    }

    return "unknown";
  }

  function stableBlockId(prefix, index) {
    return `${prefix}-${String(index + 1).padStart(3, "0")}`;
  }

  function buildContentBlock(blockId, text) {
    return {
      block_id: blockId,
      text: normalizeText(text),
    };
  }

  function extractProduct() {
    const title = getText("[data-product-title]") || normalizeText(document.title);
    const priceText = getText("[data-product-price]");

    return {
      title,
      price: parseMoney(priceText),
      price_text: priceText,
      trade_location: getText("[data-trade-location]"),
    };
  }

  function extractSeller(platform) {
    const sellerNode = document.querySelector("[data-seller-id]");

    return {
      seller_id: sellerNode?.dataset.sellerId || `${platform}-seller`,
      nickname: getText("[data-seller-name]") || "unknown",
    };
  }

  function extractBuyer() {
    return {
      nickname: getText("[data-buyer-name]") || "safe-buyer",
    };
  }

  function extractChatMessages() {
    return Array.from(document.querySelectorAll(CHAT_MESSAGE_SELECTOR)).map((node, index) => ({
      block_id: node.dataset.messageId || stableBlockId("chat", index),
      speaker_role: node.dataset.role || "unknown",
      speaker_name: node.dataset.speaker || "",
      timestamp: node.dataset.timestamp || "",
      text: normalizeText(node.textContent),
    }));
  }

  function extractReadableTextBlocks() {
    const blocks = [];
    const seen = new Set();
    const selectors = [
      "[data-product-title]",
      "[data-product-price]",
      "[data-trade-location]",
      "[data-seller-name]",
      CHAT_MESSAGE_SELECTOR,
    ];

    for (const node of document.querySelectorAll(selectors.join(","))) {
      if (node.closest("#safe-ticket-chat-scan-panel")) {
        continue;
      }

      const text = normalizeText(node.textContent);
      if (!text || seen.has(text)) {
        continue;
      }

      seen.add(text);
      blocks.push({
        block_id: node.dataset.messageId || stableBlockId("text", blocks.length),
        source: node.matches(CHAT_MESSAGE_SELECTOR) ? "chat_message" : "page_field",
        selector: node.matches(CHAT_MESSAGE_SELECTOR)
          ? CHAT_MESSAGE_SELECTOR
          : selectors.find((selector) => node.matches(selector)),
        text,
      });
    }

    return blocks;
  }

  function buildScanPayload(parsed) {
    const contentBlocks = [
      buildContentBlock("title", parsed.product.title || parsed.page_title),
      buildContentBlock(
        "product-summary",
        [parsed.product.title, parsed.product.price_text, parsed.product.trade_location]
          .filter(Boolean)
          .join(" ")
      ),
      ...parsed.chat_messages.map((message) => buildContentBlock(message.block_id, message.text)),
    ].filter((block) => block.text);

    return {
      platform: parsed.platform,
      page_url: parsed.page_url,
      page_title: parsed.product.title || parsed.page_title,
      price: parsed.product.price,
      seller: parsed.seller,
      content_blocks: contentBlocks,
    };
  }

  function parseCurrentPage() {
    const root = document.querySelector(CHAT_ROOT_SELECTOR);
    const platform = inferPlatform(root);
    const product = extractProduct();

    const parsed = {
      parser_version: PARSER_VERSION,
      platform,
      page_type: root?.dataset.pageKind || "trade-chat",
      page_url: getPageUrl(platform),
      page_title: normalizeText(document.title),
      product,
      seller: extractSeller(platform),
      buyer: extractBuyer(),
      chat_messages: extractChatMessages(),
      source_text_blocks: extractReadableTextBlocks(),
      parsed_at: new Date().toISOString(),
    };

    parsed.scanPayload = buildScanPayload(parsed);
    window.safeTicketParsedPage = parsed;
    window.safeTicketBackendPayload = parsed.scanPayload;

    return parsed;
  }

  window.SafeTicketPageParser = {
    version: PARSER_VERSION,
    normalizeText,
    parseMoney,
    extractProduct,
    extractSeller,
    extractBuyer,
    extractChatMessages,
    extractReadableTextBlocks,
    buildScanPayload,
    parseCurrentPage,
  };
})();
