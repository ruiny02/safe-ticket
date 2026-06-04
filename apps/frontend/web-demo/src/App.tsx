import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  buildChatRequestPayload,
  requestRemoteChatReply,
  type ChatConversationMessage,
} from "../../shared/chat-api";
import {
  enhanceJoongnaProductPayloadFromDocument,
  isReliableJoongnaProductPayload,
} from "../../shared/joonggonara";
import { buildScanPayload, parseMarketplacePageHtml } from "../../shared/marketplace";
import { createScan, createScanSync, getScan } from "../../shared/scan-api";
import type { ScanCreateRequest, ScanHighlightTarget, ScanResultResponse } from "../../shared/types";
import { buildLocalChatHighlightTargets, mergeHighlightTargets } from "./lib/chat-rules";
import { buildAssistantReply, buildChatWelcomeMessage, buildSuggestedPrompts } from "./lib/chatbot";
import { applyPageHighlights, clearPageHighlights } from "./lib/highlight";
import { applyPanelLayout, clearPanelLayout } from "./lib/page-layout";
import { buildPanelContent } from "./lib/panel-content";
import { buildDashboardPageUrl, buildReportPageUrl } from "./lib/report-link";

const API_BASE_URL = "http://127.0.0.1:8000";
const LATEST_SCAN_STORAGE_KEY = "safeTicketLatestScan";
const SAFE_TICKET_ICON_PATH = "icons/safe-ticket-icon-128.png";

interface AppProps {
  pageUrl: string;
}

type PanelTab = "analysis" | "chat";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

function readCurrentPageUrl(): string {
  return window.location.href;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("ko-KR").format(price);
}

function formatRiskScore(riskScore: number | null | undefined): string {
  if (riskScore === null || riskScore === undefined) {
    return "--";
  }

  return `${Math.round(riskScore * 100)}`;
}

function getHostLabel(pageUrl: string): string {
  try {
    return new URL(pageUrl).host;
  } catch {
    return pageUrl;
  }
}

function createMessage(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role,
    text,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function readMarketplaceHtml(pageUrl: string): Promise<string> {
  const shouldFetchSource = /https:\/\/web\.joongna\.com\//i.test(pageUrl);

  if (!shouldFetchSource) {
    return document.documentElement.outerHTML;
  }

  try {
    const response = await window.fetch(pageUrl, {
      credentials: "include",
      cache: "no-store",
    });

    if (response.ok) {
      return await response.text();
    }
  } catch {
    // Live DOM snapshot remains the reliable fallback inside content scripts.
  }

  return document.documentElement.outerHTML;
}

function getExtensionAssetUrl(path: string): string {
  const extensionApi = (globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        getURL?: (assetPath: string) => string;
      };
    };
  }).chrome;

  return extensionApi?.runtime?.getURL?.(path) ?? path;
}

function isTradeChatPayload(payload: ScanCreateRequest): boolean {
  return (
    /(?:chat|talk|message)/i.test(payload.page_url) ||
    payload.content_blocks.some((block) => /^(?:chat|jn-chat|bg-chat)-/i.test(block.block_id))
  );
}

async function pollScanResult(scanId: string, pollAfterMs: number): Promise<ScanResultResponse> {
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await getScan(API_BASE_URL, scanId);
    if (result.status !== "queued" && result.status !== "processing") {
      return result;
    }

    await wait(pollAfterMs);
  }

  throw new Error("Timed out while waiting for scan result");
}

async function persistLatestScan(pageUrl: string, scanId: string): Promise<void> {
  const extensionApi = (globalThis as typeof globalThis & {
    chrome?: {
      storage?: {
        local?: {
          set: (items: Record<string, unknown>) => Promise<void>;
        };
      };
    };
  }).chrome;

  if (!extensionApi?.storage?.local) {
    return;
  }

  await extensionApi.storage.local.set({
    [LATEST_SCAN_STORAGE_KEY]: {
      pageUrl,
      scanId,
    },
  });
}

export function App({ pageUrl }: AppProps) {
  const parseRequestIdRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);

  const [payload, setPayload] = useState<ScanCreateRequest | null>(null);
  const [currentPageUrl, setCurrentPageUrl] = useState(pageUrl);
  const [scanResult, setScanResult] = useState<ScanResultResponse | null>(null);
  const [localHighlightTargets, setLocalHighlightTargets] = useState<ScanHighlightTarget[]>([]);
  const [appliedHighlights, setAppliedHighlights] = useState<ScanHighlightTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>("analysis");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatSource, setChatSource] = useState<"local" | "remote">("local");

  const visibleScanResult = useMemo<ScanResultResponse | null>(() => {
    if (!scanResult) {
      return null;
    }

    return {
      ...scanResult,
      highlight_targets: mergeHighlightTargets(scanResult.highlight_targets, localHighlightTargets),
    };
  }, [localHighlightTargets, scanResult]);

  const panelContent = buildPanelContent({
    pageUrl: currentPageUrl,
    payload,
    scanResult: visibleScanResult,
    appliedHighlights,
  });
  const chatSuggestions = buildSuggestedPrompts(payload, visibleScanResult);
  const welcomeMessage = buildChatWelcomeMessage(payload, visibleScanResult);

  const parseCurrentPage = async (options?: { silent?: boolean }): Promise<boolean> => {
    const requestId = ++parseRequestIdRef.current;
    const activePageUrl = readCurrentPageUrl();

    try {
      const sourceHtml = await readMarketplaceHtml(activePageUrl);
      const parsedPayload = buildScanPayload(parseMarketplacePageHtml(sourceHtml, activePageUrl));
      const nextPayload = enhanceJoongnaProductPayloadFromDocument(document, parsedPayload);
      const isReliablePayload = isReliableJoongnaProductPayload(nextPayload);

      if (requestId !== parseRequestIdRef.current || activePageUrl !== readCurrentPageUrl()) {
        return false;
      }

      if (!isReliablePayload) {
        if (!options?.silent) {
          setPayload(null);
          setScanResult(null);
          setLocalHighlightTargets([]);
          setAppliedHighlights([]);
          clearPageHighlights();
          setError("페이지 정보를 더 읽는 중이에요. 잠시 후 다시 시도해 주세요.");
        }
        return false;
      }

      setPayload(nextPayload);
      setCurrentPageUrl(activePageUrl);
      if (!options?.silent) {
        setScanResult(null);
        setLocalHighlightTargets([]);
        setAppliedHighlights([]);
        clearPageHighlights();
        bodyRef.current?.scrollTo({ top: 0 });
      }
      setError(null);
      return true;
    } catch (nextError) {
      if (!options?.silent) {
        setPayload(null);
        setScanResult(null);
        setLocalHighlightTargets([]);
        setAppliedHighlights([]);
        clearPageHighlights();
        setError(nextError instanceof Error ? nextError.message : "Unknown parse error");
      }
      return false;
    }
  };

  const handleParse = () => {
    void parseCurrentPage();
  };

  const handleSubmit = async () => {
    if (!payload) {
      return;
    }

    setError(null);
    setIsSending(true);

    try {
      let nextScanResult: ScanResultResponse;

      try {
        nextScanResult = await createScanSync(API_BASE_URL, payload);
      } catch {
        const nextResponse = await createScan(API_BASE_URL, payload);
        nextScanResult = await pollScanResult(nextResponse.scan_id, nextResponse.poll_after_ms);
      }

      setLocalHighlightTargets(isTradeChatPayload(payload) ? buildLocalChatHighlightTargets(payload) : []);
      setScanResult(nextScanResult);
      bodyRef.current?.scrollTo({ top: 0 });
      await persistLatestScan(currentPageUrl, nextScanResult.scan_id);
    } catch (nextError) {
      setScanResult(null);
      setLocalHighlightTargets([]);
      setAppliedHighlights([]);
      clearPageHighlights();
      setError(nextError instanceof Error ? nextError.message : "Unknown submit error");
    } finally {
      setIsSending(false);
    }
  };

  const handleChatSubmit = async (eventOrPrompt?: FormEvent<HTMLFormElement> | string) => {
    if (typeof eventOrPrompt !== "string") {
      eventOrPrompt?.preventDefault();
    }

    const prompt = (typeof eventOrPrompt === "string" ? eventOrPrompt : chatInput).trim();

    if (!prompt || isChatLoading) {
      return;
    }

    setChatError(null);
    setChatInput("");
    setIsChatLoading(true);
    setChatMessages((current) => [...current, createMessage("user", prompt)]);

    try {
      await wait(300);

      const conversationMessages: ChatConversationMessage[] = [
        ...chatMessages.map((message) => ({
          role: message.role,
          text: message.text,
        })),
        {
          role: "user",
          text: prompt,
        },
      ];

      const remoteReply = await requestRemoteChatReply(
        API_BASE_URL,
        buildChatRequestPayload({
          messages: conversationMessages,
          pageUrl: currentPageUrl,
          payload,
          prompt,
          scanResult: visibleScanResult,
        }),
      );

      const reply =
        remoteReply.reply ??
        buildAssistantReply({
          payload,
          prompt,
          scanResult: visibleScanResult,
        });

      setChatMessages((current) => [...current, createMessage("assistant", reply)]);
      setChatSource(remoteReply.source);
    } catch (nextError) {
      setChatError(nextError instanceof Error ? nextError.message : "Unknown chat error");
    } finally {
      setIsChatLoading(false);
    }
  };

  useEffect(() => {
    void parseCurrentPage({ silent: true });
  }, [currentPageUrl]);

  useEffect(() => {
    let previousUrl = readCurrentPageUrl();

    const intervalId = window.setInterval(() => {
      const nextUrl = readCurrentPageUrl();

      if (nextUrl !== previousUrl) {
        previousUrl = nextUrl;
        setCurrentPageUrl(nextUrl);
        setPayload(null);
        setScanResult(null);
        setLocalHighlightTargets([]);
        setAppliedHighlights([]);
        clearPageHighlights();
        setError(null);
      }
    }, 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (payload || !document.body) {
      return;
    }

    let attemptCount = 0;
    let stopped = false;
    let intervalId = 0;
    let isTrying = false;

    const observer = new MutationObserver(() => {
      void tryUntilReady();
    });

    const stop = () => {
      stopped = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      observer.disconnect();
    };

    const tryUntilReady = async () => {
      if (stopped || isTrying) {
        return;
      }

      isTrying = true;
      attemptCount += 1;
      try {
        if (await parseCurrentPage({ silent: true })) {
          stop();
          return;
        }
      } finally {
        isTrying = false;
      }

      if (attemptCount >= 12) {
        stop();
        setError("페이지 정보를 아직 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      }
    };

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    intervalId = window.setInterval(tryUntilReady, 800);
    void tryUntilReady();

    return () => {
      stop();
    };
  }, [currentPageUrl, payload]);

  useEffect(() => {
    if (!payload || !document.body) {
      return;
    }

    let scheduled = 0;

    const syncVisibleDetails = () => {
      const nextPayload = enhanceJoongnaProductPayloadFromDocument(document, payload);

      if (JSON.stringify(nextPayload) !== JSON.stringify(payload)) {
        setPayload(nextPayload);
      }
    };

    const observer = new MutationObserver(() => {
      if (scheduled) {
        window.clearTimeout(scheduled);
      }

      scheduled = window.setTimeout(syncVisibleDetails, 180);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scheduled = window.setTimeout(syncVisibleDetails, 0);

    return () => {
      if (scheduled) {
        window.clearTimeout(scheduled);
      }
      observer.disconnect();
    };
  }, [payload, currentPageUrl]);

  useEffect(() => {
    setChatMessages([]);
    setChatError(null);
    setChatInput("");
    setIsChatLoading(false);
    setChatSource("local");
  }, [payload, visibleScanResult]);

  useEffect(() => {
    const chatLogElement = chatLogRef.current;

    if (!chatLogElement) {
      return;
    }

    chatLogElement.scrollTop = chatLogElement.scrollHeight;
  }, [chatMessages, isChatLoading]);

  useEffect(() => {
    if (!visibleScanResult || (visibleScanResult.status !== "completed" && visibleScanResult.status !== "partial")) {
      setAppliedHighlights([]);
      clearPageHighlights();
      return;
    }

    let ignoreMutations = false;
    let scheduled = 0;

    const syncHighlights = () => {
      ignoreMutations = true;
      setAppliedHighlights(applyPageHighlights(visibleScanResult.highlight_targets));
      window.setTimeout(() => {
        ignoreMutations = false;
      }, 0);
    };

    const observer = new MutationObserver(() => {
      if (ignoreMutations) {
        return;
      }

      if (scheduled) {
        window.clearTimeout(scheduled);
      }

      scheduled = window.setTimeout(syncHighlights, 120);
    });

    syncHighlights();

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      if (scheduled) {
        window.clearTimeout(scheduled);
      }
      observer.disconnect();
      setAppliedHighlights([]);
      clearPageHighlights();
    };
  }, [visibleScanResult]);

  useEffect(() => {
    applyPanelLayout(isCollapsed);
    const handleResize = () => applyPanelLayout(isCollapsed);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearPanelLayout();
    };
  }, [isCollapsed]);

  return (
    <aside className={`safe-ticket-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <header className="safe-ticket-header">
        <div className="safe-ticket-brand">
          <span
            aria-hidden="true"
            className="safe-ticket-brand-mark"
            style={{
              backgroundImage: `linear-gradient(135deg, rgba(132, 112, 255, 0.26), rgba(111, 92, 243, 0.12)), url("${getExtensionAssetUrl(SAFE_TICKET_ICON_PATH)}")`,
            }}
          />
          <div>
            <p className="safe-ticket-eyebrow">safe-ticket</p>
            <h1>거래 스캔</h1>
          </div>
        </div>
        <button
          className="safe-ticket-icon-button"
          onClick={() => setIsCollapsed((value) => !value)}
          type="button"
        >
          {isCollapsed ? "열기" : "접기"}
        </button>
      </header>

      {!isCollapsed ? (
        <>
          <div className="safe-ticket-body" ref={bodyRef}>
            <section className={`safe-ticket-hero tone-${panelContent.tone}`}>
              <div className="safe-ticket-hero-copy">
                <p className="safe-ticket-hero-status">{panelContent.statusLabel}</p>
                <h2>{panelContent.headline}</h2>
                <p>{panelContent.summary}</p>
              </div>
              <div className="safe-ticket-hero-score">
                <span>risk</span>
                <strong>{formatRiskScore(visibleScanResult?.risk_score)}</strong>
              </div>
            </section>

            <section className="safe-ticket-cta-row is-split">
              {visibleScanResult ? (
                <>
                  <a
                    className="safe-ticket-secondary safe-ticket-link-button safe-ticket-report-cta"
                    href={buildDashboardPageUrl(visibleScanResult.scan_id)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    대시보드 보기
                  </a>
                  <a
                    className="safe-ticket-primary safe-ticket-link-button safe-ticket-report-cta"
                    href={buildReportPageUrl(visibleScanResult.scan_id)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    리포트 보기
                  </a>
                </>
              ) : (
                <>
                  <span
                    aria-disabled="true"
                    className="safe-ticket-secondary safe-ticket-link-button safe-ticket-report-cta is-disabled"
                  >
                    대시보드 보기
                  </span>
                  <span
                    aria-disabled="true"
                    className="safe-ticket-primary safe-ticket-link-button safe-ticket-report-cta is-disabled"
                  >
                    리포트 보기
                  </span>
                </>
              )}
            </section>

            <nav className="safe-ticket-tab-row" aria-label="safe-ticket panel tabs">
              <button
                className={`safe-ticket-tab ${activePanelTab === "analysis" ? "is-active" : ""}`}
                onClick={() => setActivePanelTab("analysis")}
                type="button"
              >
                분석
              </button>
              <button
                className={`safe-ticket-tab ${activePanelTab === "chat" ? "is-active" : ""}`}
                onClick={() => setActivePanelTab("chat")}
                type="button"
              >
                AI 질문
              </button>
            </nav>

            {activePanelTab === "analysis" ? (
              <>
                <section className="safe-ticket-card safe-ticket-card-stable safe-ticket-lookup-card">
                  <div className="safe-ticket-card-header">
                    <h2>외부 조회</h2>
                    {panelContent.externalLookups.length ? (
                      <span className="safe-ticket-badge ok">{panelContent.externalLookups.length} checks</span>
                    ) : (
                      <span className="safe-ticket-badge ok">standby</span>
                    )}
                  </div>
                  <div className="safe-ticket-lookup-list">
                    {panelContent.externalLookups.length ? (
                      panelContent.externalLookups.map((lookup) => (
                        <article
                          className={`safe-ticket-lookup-row tone-${lookup.tone}`}
                          key={`${lookup.title}:${lookup.keyword}:${lookup.statusLabel}`}
                        >
                          <div>
                            <strong>{lookup.title}</strong>
                            <span>{lookup.keyword}</span>
                          </div>
                          <p>{lookup.body}</p>
                          <small>{lookup.statusLabel}</small>
                        </article>
                      ))
                    ) : (
                      <p className="safe-ticket-empty">
                        스캔 완료 후 경찰청/더치트 조회 결과가 여기에 표시됩니다.
                      </p>
                    )}
                  </div>
                </section>

                <section className="safe-ticket-card safe-ticket-card-stable safe-ticket-current-card">
                  <div className="safe-ticket-card-header">
                    <h2>현재 거래</h2>
                    {payload ? <span className="safe-ticket-badge ok">ready</span> : null}
                    {error ? <span className="safe-ticket-badge error">error</span> : null}
                  </div>

                  {payload ? (
                    <div className="safe-ticket-summary">
                      <div className="safe-ticket-summary-row">
                        <span>제목</span>
                        <strong>{payload.page_title}</strong>
                      </div>
                      <div className="safe-ticket-summary-grid">
                        <div className="safe-ticket-summary-chip">
                          <span>플랫폼</span>
                          <strong>{payload.platform}</strong>
                        </div>
                        <div className="safe-ticket-summary-chip">
                          <span>가격</span>
                          <strong>{formatPrice(payload.price)}원</strong>
                        </div>
                        <div className="safe-ticket-summary-chip">
                          <span>판매자</span>
                          <strong>{payload.seller.nickname}</strong>
                        </div>
                        <div className="safe-ticket-summary-chip">
                          <span>신뢰지표</span>
                          <strong>{payload.marketplace_signals.length}</strong>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {error ? <p className="safe-ticket-error">{error}</p> : null}
                </section>

                <section className="safe-ticket-card safe-ticket-card-stable safe-ticket-signal-card">
                  <div className="safe-ticket-card-header">
                    <h2>핵심 신호</h2>
                    {panelContent.reasons.length ? (
                      <span className="safe-ticket-badge danger">highlighted</span>
                    ) : (
                      <span className="safe-ticket-badge ok">standby</span>
                    )}
                  </div>
                  <div className="safe-ticket-messages">
                    {panelContent.reasons.length ? (
                      <ul className="safe-ticket-list">
                        {panelContent.reasons.map((reason) => (
                          <li key={`${reason.title}:${reason.body}`}>
                            <strong>{reason.title}</strong>
                            <span>{reason.body}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="safe-ticket-empty">
                        응답이 아직 없거나, 현재 규칙 기준에서 핵심 신호가 없습니다.
                      </p>
                    )}
                  </div>
                </section>

                <section className="safe-ticket-card safe-ticket-card-stable safe-ticket-action-card">
                  <div className="safe-ticket-card-header">
                    <h2>다음 행동</h2>
                    {visibleScanResult?.recommended_actions.length ? (
                      <span className="safe-ticket-badge danger">actions</span>
                    ) : (
                      <span className="safe-ticket-badge ok">guide</span>
                    )}
                  </div>
                  <div className="safe-ticket-messages">
                    <ul className="safe-ticket-list">
                      {panelContent.actions.map((action) => (
                        <li key={`${action.title}:${action.body}`}>
                          <strong>{action.title}</strong>
                          <span>{action.body}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              </>
            ) : (
              <section className="safe-ticket-card safe-ticket-chatbot safe-ticket-chatbot-expanded">
                <div className="safe-ticket-card-header">
                  <h2>AI 질문</h2>
                  <span className={`safe-ticket-badge ${chatSource === "remote" ? "ok" : "neutral"}`}>
                    {chatSource === "remote" ? "live" : "local"}
                  </span>
                </div>

                <div className="safe-ticket-chat-context">
                  <span>현재 context</span>
                  <strong>{panelContent.headline}</strong>
                  <p>{welcomeMessage}</p>
                </div>

                <div className="safe-ticket-chat-suggestions">
                  {chatSuggestions.map((suggestion) => (
                    <button
                      className="safe-ticket-suggestion-chip"
                      disabled={isChatLoading}
                      key={suggestion}
                      onClick={() => {
                        void handleChatSubmit(suggestion);
                      }}
                      type="button"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                <div className="safe-ticket-chat-log" ref={chatLogRef}>
                  {chatMessages.map((message) => (
                    <p
                      className={`safe-ticket-chat-message ${message.role === "assistant" ? "bot" : "user"}`}
                      key={message.id}
                    >
                      {message.text}
                    </p>
                  ))}

                  {isChatLoading ? (
                    <p className="safe-ticket-chat-message bot">답변을 정리하고 있어요...</p>
                  ) : null}
                </div>

                <form className="safe-ticket-chat-form" onSubmit={handleChatSubmit}>
                  <textarea
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleChatSubmit();
                      }
                    }}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="왜 위험한가요?"
                    rows={3}
                    value={chatInput}
                  />
                  <button className="safe-ticket-primary" disabled={!chatInput.trim() || isChatLoading} type="submit">
                    {isChatLoading ? "..." : "전송"}
                  </button>
                </form>

                {chatError ? <p className="safe-ticket-error">{chatError}</p> : null}
              </section>
            )}
          </div>

          <footer className="safe-ticket-footer">
            <span>{getHostLabel(currentPageUrl)}</span>
            <div className="safe-ticket-actions">
              <button className="safe-ticket-tertiary" onClick={handleParse} type="button">
                다시 읽기
              </button>
              <button
                className="safe-ticket-primary"
                disabled={!payload || isSending}
                onClick={() => void handleSubmit()}
                type="button"
              >
                {isSending ? "스캔 중..." : "스캔 실행"}
              </button>
            </div>
          </footer>
        </>
      ) : null}
    </aside>
  );
}
