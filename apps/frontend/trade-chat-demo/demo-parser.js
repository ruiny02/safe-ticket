function buildChatScanPayload() {
  if (!window.SafeTicketPageParser?.parseCurrentPage) {
    return {
      platform: "unknown",
      page_type: "trade-chat",
      page_url: window.location.href,
      page_title: document.title,
      content_blocks: [],
      chat_messages: [],
      demo_detected_signals: [],
    };
  }

  const parsed = window.SafeTicketPageParser.parseCurrentPage();
  return {
    ...parsed,
    ...parsed.scanPayload,
    page_type: parsed.page_type,
    product: parsed.product,
    buyer: parsed.buyer,
    chat_messages: parsed.chat_messages,
    source_text_blocks: parsed.source_text_blocks,
    demo_detected_signals: [],
  };
}

function renderPayload() {
  const output = document.querySelector("[data-payload-output]");
  const payload = buildChatScanPayload();
  window.safeTicketDemoPayload = payload;

  if (!output) {
    return;
  }

  output.textContent = JSON.stringify(payload, null, 2);
}

function renderSignalList() {
  const list = document.querySelector("[data-signal-list]");
  if (!list) {
    return;
  }

  const payload = buildChatScanPayload();
  const blocks = payload.content_blocks ?? [];
  list.innerHTML = "";

  for (const block of blocks.slice(0, 8)) {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${block.block_id}</strong><span>${block.text}</span>`;
    list.appendChild(item);
  }
}

document.querySelector("[data-refresh-payload]")?.addEventListener("click", () => {
  renderPayload();
  renderSignalList();
});

renderPayload();
renderSignalList();
