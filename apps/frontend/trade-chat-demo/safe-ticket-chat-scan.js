
(function () {
  const API_BASE_URL = "http://54.180.226.121:8000";
  const DEFAULT_REPORT_APP_BASE_URL = "http://localhost:5173/report/";
  const PANEL_ID = "safe-ticket-chat-scan-panel";
  const HIGHLIGHT_SELECTOR = "mark[data-safe-ticket-chat-highlight='true']";
  const LOCAL_RISK_RULES = [
    {
      reason_code: "avoid_safe_payment",
      reason: "플랫폼 안전결제 또는 번개페이를 회피하는 표현입니다.",
      pattern: /안심결제는 정산이 늦어서 안 하고|번개페이는 정산이 늦어서 안 받아요|안심결제[^.!?\n]{0,24}(?:안 하고|안 받아요|못 해요|정산이 늦)|번개페이[^.!?\n]{0,24}(?:안 하고|안 받아요|못 해요|정산이 늦)/g,
    },
    {
      reason_code: "off_platform_contact",
      reason: "플랫폼 밖 메신저나 문자로 이동을 유도하는 표현입니다.",
      pattern: /카톡 오픈채팅|오픈채팅|카카오톡|카톡|문자로 연락|문자|텔레그램|라인/g,
    },
    {
      reason_code: "prepayment_pressure",
      reason: "선입금 또는 예약금을 먼저 요구하는 표현입니다.",
      pattern: /먼저 입금|선입금|예약금 먼저 입금|예약금/g,
    },
    {
      reason_code: "urgency_pressure",
      reason: "거래 결정을 서두르게 만드는 시간 압박 표현입니다.",
      pattern: /오늘 안에 바로 입금|오늘 안에 입금|지금 문의가 많아서|다음 분께 먼저|다음 분께 넘길게요/g,
    },
    {
      reason_code: "savings_account_pattern",
      reason: "적금계좌로 의심되는 은행별 계좌 패턴입니다.",
      pattern: /(?:농협은행|NH농협은행|농협)\s*304[\d-\s]{10,18}|케이뱅크\s*1102[\d-\s]{8,16}/g,
    },
  ];

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function injectStyles() {
    if (document.getElementById("safe-ticket-chat-scan-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "safe-ticket-chat-scan-style";
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 86px;
        right: 26px;
        z-index: 2147483647;
        width: 370px;
        min-width: 320px;
        max-width: min(520px, calc(100vw - 32px));
        min-height: 340px;
        max-height: calc(100vh - 40px);
        border: 1px solid rgba(255, 255, 255, 0.65);
        border-radius: 8px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(250, 252, 255, 0.97)),
          radial-gradient(circle at top right, rgba(255, 22, 68, 0.2), transparent 34%);
        box-shadow: 0 24px 80px rgba(17, 24, 39, 0.23);
        color: #17211f;
        font-family: Arial, Pretendard, "Noto Sans KR", sans-serif;
        overflow: auto;
        resize: both;
        backdrop-filter: blur(14px);
      }

      #${PANEL_ID} * {
        box-sizing: border-box;
      }

      .stc-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 15px 16px;
        border-bottom: 0;
        border-radius: 8px 8px 0 0;
        background: linear-gradient(135deg, #111827 0%, #df2148 100%);
        color: #ffffff;
        cursor: move;
        touch-action: none;
        user-select: none;
      }

      .stc-brand {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
      }

      .stc-mark {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
        font-weight: 900;
        font-size: 14px;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
      }

      .stc-brand strong,
      .stc-brand span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stc-brand strong {
        font-size: 15px;
      }

      .stc-brand span {
        color: rgba(255, 255, 255, 0.78);
        font-size: 12px;
        margin-top: 2px;
      }

      .stc-drag-hint {
        flex: 0 0 auto;
        border-radius: 999px;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.16);
        color: rgba(255, 255, 255, 0.86);
        font-size: 11px;
        font-weight: 900;
      }

      .stc-body {
        display: grid;
        gap: 12px;
        padding: 14px;
      }

      .stc-score {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        border: 1px solid #edf0f2;
        border-radius: 8px;
        background: #ffffff;
        padding: 14px;
        box-shadow: 0 10px 28px rgba(17, 24, 39, 0.06);
      }

      .stc-score p {
        margin: 0;
        color: #6f7882;
        line-height: 1.45;
        font-size: 12px;
      }

      .stc-score strong {
        min-width: 54px;
        min-height: 54px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        background: #f1f5f9;
        color: #334155;
        font-size: 28px;
      }

      #${PANEL_ID}[data-tone="busy"] .stc-score strong {
        background: #eef2ff;
        color: #4f46e5;
      }

      #${PANEL_ID}[data-tone="danger"] .stc-score {
        border-color: rgba(223, 33, 72, 0.22);
        background: linear-gradient(135deg, #fff7f8, #ffffff);
      }

      #${PANEL_ID}[data-tone="danger"] .stc-score strong {
        background: #ffe8ee;
        color: #c1123a;
      }

      #${PANEL_ID}[data-tone="error"] .stc-score strong {
        background: #2b2f36;
        color: #ffffff;
      }

      .stc-status {
        margin: 0;
        line-height: 1.5;
        color: #3f464d;
        font-size: 13px;
      }

      .stc-list {
        display: grid;
        gap: 7px;
        margin: 0;
        padding: 0;
        list-style: none;
        max-height: 150px;
        overflow: auto;
      }

      .stc-list li {
        border: 1px solid rgba(223, 33, 72, 0.13);
        border-radius: 8px;
        background: #ffffff;
        padding: 10px;
        line-height: 1.45;
        font-size: 12px;
        box-shadow: 0 8px 20px rgba(17, 24, 39, 0.04);
      }

      .stc-list strong {
        display: block;
        color: #d7193f;
        margin-bottom: 2px;
      }

      .stc-lookup-card {
        display: grid;
        gap: 9px;
        border: 1px solid #edf0f2;
        border-radius: 8px;
        background: #ffffff;
        padding: 12px;
        box-shadow: 0 10px 28px rgba(17, 24, 39, 0.05);
      }

      .stc-lookup-card[hidden] {
        display: none;
      }

      .stc-lookup-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .stc-lookup-head strong {
        color: #17211f;
        font-size: 13px;
      }

      .stc-lookup-head span {
        border-radius: 999px;
        background: #f8fafc;
        color: #64748b;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 900;
      }

      .stc-lookup-list {
        display: grid;
        gap: 7px;
      }

      .stc-lookup-row {
        display: grid;
        gap: 6px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 9px;
        background: #ffffff;
        line-height: 1.4;
      }

      .stc-lookup-row.is-danger {
        border-color: rgba(223, 33, 72, 0.24);
        background: #fff7f8;
      }

      .stc-lookup-row.is-warning {
        border-color: rgba(245, 158, 11, 0.28);
        background: #fffbeb;
      }

      .stc-lookup-row.is-ok {
        border-color: rgba(34, 197, 94, 0.2);
        background: #f7fef9;
      }

      .stc-lookup-row-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .stc-lookup-row strong {
        color: #17211f;
        font-size: 12px;
      }

      .stc-lookup-row p {
        margin: 0;
        color: #4b5563;
        font-size: 12px;
      }

      .stc-lookup-row small {
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
      }

      .stc-lookup-status {
        flex: 0 0 auto;
        border-radius: 999px;
        background: #f1f5f9;
        color: #475569;
        padding: 3px 7px;
        font-size: 10px;
        font-weight: 900;
      }

      .stc-lookup-row.is-danger .stc-lookup-status {
        background: #ffe8ee;
        color: #c1123a;
      }

      .stc-lookup-row.is-warning .stc-lookup-status {
        background: #fef3c7;
        color: #92400e;
      }

      .stc-lookup-row.is-ok .stc-lookup-status {
        background: #dcfce7;
        color: #166534;
      }

      .stc-actions {
        display: flex;
        gap: 8px;
      }

      .stc-report-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .stc-report-link {
        min-height: 40px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(223, 33, 72, 0.2);
        border-radius: 8px;
        background: #ffffff;
        color: #c1123a;
        font-size: 13px;
        font-weight: 900;
        text-decoration: none;
      }

      .stc-report-link.is-disabled {
        pointer-events: none;
        border-color: #e5e7eb;
        color: #9ca3af;
        background: #f8fafc;
      }

      .stc-button {
        flex: 1;
        min-height: 42px;
        border: 1px solid #dce1e6;
        border-radius: 8px;
        background: #fff;
        color: #17211f;
        font-weight: 900;
        cursor: pointer;
      }

      .stc-button.primary {
        border-color: #df2148;
        background: linear-gradient(135deg, #ff3158, #df2148);
        color: #fff;
        box-shadow: 0 10px 22px rgba(223, 33, 72, 0.22);
      }

      .stc-button:disabled {
        cursor: not-allowed;
        opacity: 0.58;
      }

      .stc-chatbot {
        display: grid;
        gap: 9px;
        border: 1px solid #edf0f2;
        border-radius: 8px;
        background: #ffffff;
        padding: 12px;
      }

      .stc-chatbot-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .stc-chatbot-head strong {
        font-size: 13px;
      }

      .stc-chatbot-head span {
        border-radius: 999px;
        background: #f1f5f9;
        color: #64748b;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 900;
      }

      .stc-chatbot-log {
        display: grid;
        gap: 7px;
        max-height: 110px;
        overflow: auto;
      }

      .stc-chat-msg {
        border-radius: 8px;
        padding: 8px 10px;
        line-height: 1.45;
        font-size: 12px;
      }

      .stc-chat-msg.bot {
        background: #f8fafc;
        color: #334155;
      }

      .stc-chat-msg.user {
        justify-self: end;
        background: #ffe8ee;
        color: #9f1239;
      }

      .stc-chat-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
      }

      .stc-chat-form input {
        min-width: 0;
        height: 38px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 0 11px;
        outline: 0;
      }

      .stc-chat-form button {
        width: 54px;
        border: 0;
        border-radius: 8px;
        background: #111827;
        color: #ffffff;
        font-weight: 900;
      }

      mark.safe-ticket-highlight-danger,
      mark[data-safe-ticket-chat-highlight='true'] {
        border-radius: 4px;
        background: rgba(255, 22, 68, 0.2);
        color: #aa0828;
        box-shadow: inset 0 -1px 0 rgba(255, 22, 68, 0.45);
        padding: 0 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function getText(selector) {
    return document.querySelector(selector)?.textContent?.trim() ?? "";
  }

  function parsePrice(value) {
    const digits = value.replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }

  function getMessages() {
    return Array.from(document.querySelectorAll("[data-chat-message]")).map((node) => ({
      block_id: node.dataset.messageId,
      text: node.textContent.trim(),
    }));
  }

  function buildBackendPayload() {
    if (window.SafeTicketPageParser?.parseCurrentPage) {
      const parsed = window.SafeTicketPageParser.parseCurrentPage();
      window.safeTicketParsedPage = parsed;
      return parsed.scanPayload;
    }

    const chatRoot = document.querySelector("[data-safe-ticket-chat]");
    const sellerNode = document.querySelector("[data-seller-id]");
    const platform = chatRoot?.dataset.platform ?? "unknown";
    const messages = getMessages();
    const title = getText("[data-product-title]") || document.title;
    const pageUrl =
      window.location.protocol === "http:" || window.location.protocol === "https:"
        ? window.location.href
        : `http://54.180.226.121:3000/${platform}-chat.html`;

    return {
      platform,
      page_url: pageUrl,
      page_title: title,
      price: parsePrice(getText("[data-product-price]")),
      seller: {
        seller_id: sellerNode?.dataset.sellerId ?? `${platform}-seller`,
        nickname: getText("[data-seller-name]") || "unknown",
      },
      content_blocks: [
        {
          block_id: "title",
          text: title,
        },
        ...messages,
      ],
    };
  }

  async function createScan(payload) {
    const response = await fetch(`${API_BASE_URL}/api/v1/scans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`POST /scans failed: ${response.status} ${detail}`);
    }

    return response.json();
  }

  async function getScan(scanId) {
    const response = await fetch(`${API_BASE_URL}/api/v1/scans/${scanId}`);

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GET /scans/${scanId} failed: ${response.status} ${detail}`);
    }

    return response.json();
  }

  async function pollScan(scanId, pollAfterMs) {
    for (let index = 0; index < 8; index += 1) {
      const result = await getScan(scanId);
      if (result.status !== "queued" && result.status !== "processing") {
        return result;
      }
      await wait(pollAfterMs || 1000);
    }

    throw new Error("스캔 결과 대기 시간이 초과되었습니다.");
  }

  function clearHighlights() {
    for (const highlight of document.querySelectorAll(HIGHLIGHT_SELECTOR)) {
      const parent = highlight.parentNode;
      if (!parent) {
        continue;
      }

      parent.replaceChild(document.createTextNode(highlight.textContent ?? ""), highlight);
      parent.normalize();
    }
  }

  function applyHighlights(targets) {
    clearHighlights();

    for (const target of targets) {
      if (!target.matched_text?.trim()) {
        continue;
      }

      const root =
        document.querySelector(`[data-message-id="${CSS.escape(target.block_id)}"]`) ??
        document.querySelector("[data-safe-ticket-chat]");
      highlightFirstMatch(root, target);
    }
  }

  function buildLocalHighlightTargets(payload) {
    const targets = [];

    for (const block of payload.content_blocks ?? []) {
      if (!block.block_id || !block.text) {
        continue;
      }

      for (const rule of LOCAL_RISK_RULES) {
        rule.pattern.lastIndex = 0;

        for (const match of block.text.matchAll(rule.pattern)) {
          const matchedText = match[0].trim();
          if (!matchedText) {
            continue;
          }

          const start = match.index ?? block.text.indexOf(match[0]);
          targets.push({
            block_id: block.block_id,
            start,
            end: start + match[0].length,
            matched_text: matchedText,
            reason_code: rule.reason_code,
            reason: rule.reason,
            css_class: "safe-ticket-highlight-danger",
            source: "local-demo-rule",
          });
        }
      }
    }

    return targets;
  }

  function mergeHighlightTargets(backendTargets, localTargets) {
    const merged = [];
    const seen = new Set();

    for (const target of [...(backendTargets ?? []), ...(localTargets ?? [])]) {
      const key = `${target.block_id}:${target.matched_text}:${target.reason_code}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(target);
    }

    return merged;
  }

  function buildExternalLookupRows(results) {
    return window.SafeTicketExternalLookupDisplay?.buildExternalLookupRows?.(results) ?? [];
  }

  function highlightFirstMatch(root, target) {
    if (!root) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue ?? "";
        if (!text.includes(target.matched_text)) {
          return NodeFilter.FILTER_SKIP;
        }

        const parent = node.parentElement;
        if (!parent || parent.closest(`#${PANEL_ID}`) || parent.closest(HIGHLIGHT_SELECTOR)) {
          return NodeFilter.FILTER_SKIP;
        }

        if (["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNode = walker.nextNode();
    if (!textNode) {
      return;
    }

    const originalText = textNode.nodeValue ?? "";
    const matchIndex = originalText.indexOf(target.matched_text);
    if (matchIndex < 0) {
      return;
    }

    const before = originalText.slice(0, matchIndex);
    const match = originalText.slice(matchIndex, matchIndex + target.matched_text.length);
    const after = originalText.slice(matchIndex + target.matched_text.length);
    const mark = document.createElement("mark");
    mark.className = target.css_class || "safe-ticket-highlight-danger";
    mark.dataset.safeTicketChatHighlight = "true";
    mark.dataset.reasonCode = target.reason_code || "";
    mark.title = target.reason || "";
    mark.textContent = match;

    const fragment = document.createDocumentFragment();
    if (before) {
      fragment.appendChild(document.createTextNode(before));
    }
    fragment.appendChild(mark);
    if (after) {
      fragment.appendChild(document.createTextNode(after));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  function setPanelState(state) {
    const root = document.getElementById(PANEL_ID);
    if (!root) {
      return;
    }

    root.dataset.tone = state.tone || "idle";

    const score = root.querySelector("[data-stc-score]");
    const status = root.querySelector("[data-stc-status]");
    const list = root.querySelector("[data-stc-list]");
    const lookupCard = root.querySelector("[data-stc-lookup-card]");
    const lookupList = root.querySelector("[data-stc-lookup-list]");
    const submit = root.querySelector("[data-stc-submit]");
    const dashboardLink = root.querySelector("[data-stc-dashboard-link]");
    const reportLink = root.querySelector("[data-stc-report-link]");

    score.textContent = state.score;
    status.textContent = state.status;
    submit.disabled = Boolean(state.busy);

    if (state.scanId) {
      dashboardLink.href = buildReportUrl("dashboard", state.scanId);
      reportLink.href = buildReportUrl("reports", state.scanId);
      dashboardLink.classList.remove("is-disabled");
      reportLink.classList.remove("is-disabled");
      dashboardLink.setAttribute("aria-disabled", "false");
      reportLink.setAttribute("aria-disabled", "false");
    } else {
      dashboardLink.removeAttribute("href");
      reportLink.removeAttribute("href");
      dashboardLink.classList.add("is-disabled");
      reportLink.classList.add("is-disabled");
      dashboardLink.setAttribute("aria-disabled", "true");
      reportLink.setAttribute("aria-disabled", "true");
    }

    list.innerHTML = "";
    for (const item of state.items ?? []) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span>`;
      list.appendChild(li);
    }

    const externalLookups = state.externalLookups ?? [];
    lookupCard.hidden = externalLookups.length === 0;
    lookupList.innerHTML = "";
    for (const lookup of externalLookups) {
      const row = document.createElement("article");
      row.className = `stc-lookup-row is-${escapeHtml(lookup.tone)}`;
      row.innerHTML = `
        <div class="stc-lookup-row-head">
          <strong>${escapeHtml(lookup.title)}</strong>
          <span class="stc-lookup-status">${escapeHtml(lookup.statusLabel)}</span>
        </div>
        <small>${escapeHtml(lookup.keyword)}</small>
        <p>${escapeHtml(lookup.message)}</p>
      `;
      lookupList.appendChild(row);
    }
  }

  function buildReportUrl(view, scanId) {
    const encodedScanId = encodeURIComponent(scanId);
    const baseUrl =
      window.safeTicketReportBaseUrl ||
      window.localStorage?.getItem("safeTicketReportBaseUrl") ||
      DEFAULT_REPORT_APP_BASE_URL;

    if (view === "dashboard") {
      return `${baseUrl}#/dashboard?scanId=${encodedScanId}`;
    }

    return `${baseUrl}#/reports/${encodedScanId}`;
  }

  function makePanelDraggable(panel) {
    const handle = panel.querySelector(".stc-head");
    if (!handle) {
      return;
    }

    let dragState = null;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";

      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const nextLeft = clamp(
        dragState.left + event.clientX - dragState.startX,
        8,
        window.innerWidth - dragState.width - 8,
      );
      const nextTop = clamp(
        dragState.top + event.clientY - dragState.startY,
        8,
        window.innerHeight - dragState.height - 8,
      );

      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    handle.addEventListener("pointerup", (event) => {
      if (dragState?.pointerId === event.pointerId) {
        dragState = null;
        handle.releasePointerCapture(event.pointerId);
      }
    });

    handle.addEventListener("pointercancel", () => {
      dragState = null;
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderPanel() {
    injectStyles();

    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      return existing;
    }

    const root = document.createElement("aside");
    root.id = PANEL_ID;
    root.innerHTML = `
      <header class="stc-head">
        <div class="stc-brand">
          <span class="stc-mark">S</span>
          <div>
            <strong>safe-ticket</strong>
            <span>채팅 스캔</span>
          </div>
        </div>
        <span class="stc-drag-hint">이동</span>
      </header>
      <div class="stc-body">
        <section class="stc-score">
          <p data-stc-status>채팅 메시지를 읽었습니다. 스캔을 실행하면 백엔드 응답 기준으로 문구를 표시합니다.</p>
          <strong data-stc-score>--</strong>
        </section>
        <ul class="stc-list" data-stc-list></ul>
        <section class="stc-lookup-card" data-stc-lookup-card hidden>
          <div class="stc-lookup-head">
            <strong>외부 조회</strong>
            <span>경찰청 · 더치트</span>
          </div>
          <div class="stc-lookup-list" data-stc-lookup-list></div>
        </section>
        <div class="stc-report-actions">
          <a class="stc-report-link is-disabled" data-stc-dashboard-link aria-disabled="true" target="_blank" rel="noreferrer">대시보드 보기</a>
          <a class="stc-report-link is-disabled" data-stc-report-link aria-disabled="true" target="_blank" rel="noreferrer">리포트 보기</a>
        </div>
        <div class="stc-actions">
          <button class="stc-button" data-stc-clear type="button">초기화</button>
          <button class="stc-button primary" data-stc-submit type="button">스캔 실행</button>
        </div>
        <section class="stc-chatbot">
          <div class="stc-chatbot-head">
            <strong>질문하기</strong>
            <span>UI only</span>
          </div>
          <div class="stc-chatbot-log" data-stc-chat-log>
            <div class="stc-chat-msg bot">스캔 결과를 바탕으로 궁금한 점을 물어볼 수 있는 영역입니다. 대화용 API가 연결되면 답변이 표시됩니다.</div>
          </div>
          <form class="stc-chat-form" data-stc-chat-form>
            <input data-stc-chat-input placeholder="왜 위험한가요?" />
            <button type="submit">전송</button>
          </form>
        </section>
      </div>
    `;

    document.body.appendChild(root);
    makePanelDraggable(root);
    root.querySelector("[data-stc-clear]").addEventListener("click", () => {
      clearHighlights();
      setPanelState({
        score: "--",
        status: "하이라이트를 초기화했습니다.",
        items: [],
        externalLookups: [],
        busy: false,
        tone: "idle",
        scanId: null,
      });
    });
    root.querySelector("[data-stc-submit]").addEventListener("click", () => {
      void runScan();
    });
    root.querySelector("[data-stc-chat-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      addChatPlaceholder(root);
    });

    return root;
  }

  function addChatPlaceholder(root) {
    const input = root.querySelector("[data-stc-chat-input]");
    const log = root.querySelector("[data-stc-chat-log]");
    const value = input.value.trim();

    if (!value) {
      return;
    }

    const userMessage = document.createElement("div");
    userMessage.className = "stc-chat-msg user";
    userMessage.textContent = value;
    log.appendChild(userMessage);

    const botMessage = document.createElement("div");
    botMessage.className = "stc-chat-msg bot";
    botMessage.textContent = "아직 대화용 백엔드 API가 연결되지 않았습니다. 이후 /chat 같은 endpoint가 생기면 이 영역에 답변을 표시할 수 있습니다.";
    log.appendChild(botMessage);

    input.value = "";
    log.scrollTop = log.scrollHeight;
  }

  async function runScan() {
    const payload = buildBackendPayload();
    window.safeTicketBackendPayload = payload;

    setPanelState({
      score: "...",
      status: "백엔드로 채팅 내용을 전송하고 있습니다.",
      items: [],
      externalLookups: [],
      busy: true,
      tone: "busy",
      scanId: null,
    });

    try {
      const queued = await createScan(payload);
      setPanelState({
        score: "...",
        status: `scan_id ${queued.scan_id} 결과를 기다리는 중입니다.`,
        items: [],
        externalLookups: [],
        busy: true,
        tone: "busy",
        scanId: queued.scan_id,
      });

      const result = await pollScan(queued.scan_id, queued.poll_after_ms);
      window.safeTicketBackendResult = result;
      const localTargets = buildLocalHighlightTargets(payload);
      const targets = mergeHighlightTargets(result.highlight_targets ?? [], localTargets);
      window.safeTicketMergedHighlightTargets = targets;
      applyHighlights(targets);

      setPanelState({
        score: result.risk_score === null || result.risk_score === undefined ? "--" : String(Math.round(result.risk_score * 100)),
        status: result.summary || "스캔 결과가 도착했습니다.",
        items: targets.slice(0, 6).map((target) => ({
          title: target.matched_text,
          body: target.reason,
        })),
        externalLookups: buildExternalLookupRows(result.external_lookup_results),
        busy: false,
        tone: targets.length ? "danger" : "idle",
        scanId: result.scan_id,
      });
    } catch (error) {
      setPanelState({
        score: "!",
        status:
          error instanceof Error
            ? `${error.message}  백엔드가 실행 중인지, CORS에 현재 페이지 origin이 포함되어 있는지 확인하세요.`
            : "알 수 없는 오류가 발생했습니다.",
        items: [],
        externalLookups: [],
        busy: false,
        tone: "error",
        scanId: null,
      });
    }
  }

  if (document.querySelector("[data-safe-ticket-chat]")) {
    renderPanel();
    window.safeTicketChatScan = {
      buildBackendPayload,
      parseCurrentPage: () => window.SafeTicketPageParser?.parseCurrentPage?.(),
      runScan,
      clearHighlights,
    };
  }
})();
