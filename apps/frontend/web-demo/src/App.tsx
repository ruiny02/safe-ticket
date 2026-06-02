import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { buildScanPayload, parseMarketplacePageHtml } from "../../shared/marketplace";
import { createScan, createScanSync, getScan } from "../../shared/scan-api";
import type { ScanCreateRequest, ScanHighlightTarget, ScanResultResponse } from "../../shared/types";
import { applyPageHighlights, clearPageHighlights } from "./lib/highlight";
import { buildAssistantReply, buildChatWelcomeMessage } from "./lib/chatbot";
import {
  PANEL_COLLAPSED_WIDTH,
  clampPanelRect,
  createDefaultPanelRect,
  movePanel,
  resizePanel,
  type PanelRect,
} from "./lib/floating-panel";
import { buildPanelContent } from "./lib/panel-content";
import { buildDashboardPageUrl, buildReportPageUrl } from "./lib/report-link";

const API_BASE_URL = "http://127.0.0.1:8000";
const LATEST_SCAN_STORAGE_KEY = "safeTicketLatestScan";
const PANEL_PREFERENCES_STORAGE_KEY = "safeTicketPanelPreferences";

interface AppProps {
  pageUrl: string;
}

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

interface PanelPreferences {
  collapsed: boolean;
  rect: PanelRect;
}

interface PanelInteraction {
  mode: "drag" | "resize";
  originRect: PanelRect;
  startX: number;
  startY: number;
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

function loadPanelPreferences(): PanelPreferences {
  const fallbackRect = createDefaultPanelRect(window.innerWidth, window.innerHeight);

  try {
    const storedValue = window.localStorage.getItem(PANEL_PREFERENCES_STORAGE_KEY);

    if (!storedValue) {
      return {
        collapsed: false,
        rect: fallbackRect,
      };
    }

    const parsed = JSON.parse(storedValue) as Partial<PanelPreferences>;

    return {
      collapsed: Boolean(parsed.collapsed),
      rect: parsed.rect
        ? clampPanelRect(parsed.rect, window.innerWidth, window.innerHeight)
        : fallbackRect,
    };
  } catch {
    return {
      collapsed: false,
      rect: fallbackRect,
    };
  }
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
  const initialPanelStateRef = useRef<PanelPreferences | null>(null);

  if (!initialPanelStateRef.current) {
    initialPanelStateRef.current = loadPanelPreferences();
  }

  const [payload, setPayload] = useState<ScanCreateRequest | null>(null);
  const [scanResult, setScanResult] = useState<ScanResultResponse | null>(null);
  const [appliedHighlights, setAppliedHighlights] = useState<ScanHighlightTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [panelRect, setPanelRect] = useState<PanelRect>(initialPanelStateRef.current.rect);
  const [isCollapsed, setIsCollapsed] = useState(initialPanelStateRef.current.collapsed);
  const [isSending, setIsSending] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [interaction, setInteraction] = useState<PanelInteraction | null>(null);
  const panelContent = buildPanelContent({ pageUrl, payload, scanResult, appliedHighlights });

  const parseCurrentPage = (options?: { silent?: boolean }): boolean => {
    try {
      const nextPayload = buildScanPayload(
        parseMarketplacePageHtml(document.documentElement.outerHTML, pageUrl),
      );
      setPayload(nextPayload);
      if (!options?.silent) {
        setScanResult(null);
        setAppliedHighlights([]);
        clearPageHighlights();
      }
      setError(null);
      return true;
    } catch (nextError) {
      if (!options?.silent) {
        setPayload(null);
        setScanResult(null);
        setAppliedHighlights([]);
        clearPageHighlights();
        setError(nextError instanceof Error ? nextError.message : "Unknown parse error");
      }
      return false;
    }
  };

  const handleParse = () => {
    parseCurrentPage();
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

      setScanResult(nextScanResult);
      await persistLatestScan(pageUrl, nextScanResult.scan_id);
    } catch (nextError) {
      setScanResult(null);
      setAppliedHighlights([]);
      clearPageHighlights();
      setError(nextError instanceof Error ? nextError.message : "Unknown submit error");
    } finally {
      setIsSending(false);
    }
  };

  const handleChatSubmit = async () => {
    const prompt = chatInput.trim();

    if (!prompt || isChatLoading) {
      return;
    }

    setChatError(null);
    setChatInput("");
    setIsChatLoading(true);
    setChatMessages((current) => [...current, createMessage("user", prompt)]);

    try {
      await wait(450);

      const reply = buildAssistantReply({
        payload,
        prompt,
        scanResult,
      });

      setChatMessages((current) => [...current, createMessage("assistant", reply)]);
    } catch (nextError) {
      setChatError(nextError instanceof Error ? nextError.message : "Unknown chat error");
    } finally {
      setIsChatLoading(false);
    }
  };

  useEffect(() => {
    parseCurrentPage({ silent: true });
  }, [pageUrl]);

  useEffect(() => {
    if (payload || !document.body) {
      return;
    }

    let attemptCount = 0;
    let stopped = false;
    let intervalId = 0;

    const observer = new MutationObserver(() => {
      tryUntilReady();
    });

    const stop = () => {
      stopped = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      observer.disconnect();
    };

    const tryUntilReady = () => {
      if (stopped) {
        return;
      }

      attemptCount += 1;
      if (parseCurrentPage({ silent: true })) {
        stop();
        return;
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
    tryUntilReady();

    return () => {
      stop();
    };
  }, [pageUrl, payload]);

  useEffect(() => {
    setChatMessages([createMessage("assistant", buildChatWelcomeMessage(payload, scanResult))]);
    setChatError(null);
    setChatInput("");
    setIsChatLoading(false);
  }, [payload, scanResult]);

  useEffect(() => {
    if (!scanResult || (scanResult.status !== "completed" && scanResult.status !== "partial")) {
      setAppliedHighlights([]);
      clearPageHighlights();
      return;
    }

    let ignoreMutations = false;
    let scheduled = 0;

    const syncHighlights = () => {
      ignoreMutations = true;
      setAppliedHighlights(applyPageHighlights(scanResult.highlight_targets));
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

      scheduled = window.setTimeout(() => {
        syncHighlights();
      }, 120);
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
  }, [scanResult]);

  useEffect(() => {
    const handleResize = () => {
      setPanelRect((current) => clampPanelRect(current, window.innerWidth, window.innerHeight));
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      PANEL_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        collapsed: isCollapsed,
        rect: panelRect,
      } satisfies PanelPreferences),
    );
  }, [isCollapsed, panelRect]);

  useEffect(() => {
    if (!interaction) {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      setPanelRect(
        interaction.mode === "drag"
          ? movePanel(interaction.originRect, deltaX, deltaY, window.innerWidth, window.innerHeight)
          : resizePanel(interaction.originRect, deltaX, deltaY, window.innerWidth, window.innerHeight),
      );
    };

    const handlePointerUp = () => {
      setInteraction(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [interaction]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, textarea")) {
      return;
    }

    event.preventDefault();

    setInteraction({
      mode: "drag",
      originRect: panelRect,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    setInteraction({
      mode: "resize",
      originRect: panelRect,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const panelStyle = {
    left: `${panelRect.x}px`,
    top: `${panelRect.y}px`,
    width: isCollapsed ? `${PANEL_COLLAPSED_WIDTH}px` : `${panelRect.width}px`,
    height: isCollapsed ? undefined : `${panelRect.height}px`,
  };

  return (
    <aside
      className={`safe-ticket-panel ${isCollapsed ? "is-collapsed" : ""} ${interaction ? "is-interacting" : ""}`}
      style={panelStyle}
    >
      <header className="safe-ticket-header" onPointerDown={beginDrag}>
        <div className="safe-ticket-brand">
          <span className="safe-ticket-brand-mark">S</span>
          <div className="safe-ticket-brand-copy">
            <p className="safe-ticket-eyebrow">safe-ticket</p>
          </div>
        </div>

        <div className="safe-ticket-header-actions">
          <button
            className="safe-ticket-icon-button"
            onClick={() => setIsCollapsed((value) => !value)}
            type="button"
          >
            {isCollapsed ? "open" : "close"}
          </button>
        </div>
      </header>

      {!isCollapsed ? (
        <div className="safe-ticket-body">
          <section className="safe-ticket-summary-card">
            <div className="safe-ticket-summary-copy">
              <div className="safe-ticket-summary-topline">
                <span className={`safe-ticket-tone-pill tone-${panelContent.tone}`}>{panelContent.statusLabel}</span>
                <span className="safe-ticket-summary-headline">{panelContent.headline}</span>
              </div>
              <p>{panelContent.summary}</p>
            </div>
            <div className={`safe-ticket-summary-score tone-${panelContent.tone}`}>
              {formatRiskScore(scanResult?.risk_score)}
            </div>
          </section>

          <section className="safe-ticket-action-grid">
            <button
              className="safe-ticket-primary safe-ticket-strong-cta"
              disabled={!payload || isSending}
              onClick={() => void handleSubmit()}
              type="button"
            >
              {isSending ? "Scanning..." : "Scan"}
            </button>

            <button className="safe-ticket-tertiary" onClick={handleParse} type="button">
              Re-read
            </button>

            {scanResult ? (
              <a
                className="safe-ticket-link-button safe-ticket-secondary"
                href={buildDashboardPageUrl(scanResult.scan_id)}
                rel="noreferrer"
                target="_blank"
              >
                Dashboard
              </a>
            ) : (
              <button className="safe-ticket-secondary is-disabled" disabled type="button">
                Dashboard
              </button>
            )}

            {scanResult ? (
              <a
                className="safe-ticket-link-button safe-ticket-secondary"
                href={buildReportPageUrl(scanResult.scan_id)}
                rel="noreferrer"
                target="_blank"
              >
                Report
              </a>
            ) : (
              <button className="safe-ticket-secondary is-disabled" disabled type="button">
                Report
              </button>
            )}
          </section>

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <div>
                <h2>Risk Phrases</h2>
                <p className="safe-ticket-card-subtitle">
                  Review the highlighted phrases and why they were flagged.
                </p>
              </div>
              {appliedHighlights.length ? (
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
                <p className="safe-ticket-empty">No flagged phrases yet.</p>
              )}
            </div>
          </section>

          <section className="safe-ticket-card safe-ticket-chat-card">
            <div className="safe-ticket-card-header">
              <div>
                <h2>Chat</h2>
                <p className="safe-ticket-card-subtitle">
                  Ask follow-up questions based on the current scan result.
                </p>
              </div>
            </div>

            <div className="safe-ticket-chat-log">
              {chatMessages.map((message) => (
                <article className={`safe-ticket-chat-bubble role-${message.role}`} key={message.id}>
                  <span className="safe-ticket-chat-role">{message.role === "assistant" ? "assistant" : "user"}</span>
                  <p>{message.text}</p>
                </article>
              ))}

              {isChatLoading ? (
                <article className="safe-ticket-chat-bubble role-assistant is-loading">
                  <span className="safe-ticket-chat-role">assistant</span>
                  <p>답변을 정리하고 있어요...</p>
                </article>
              ) : null}
            </div>

            <form
              className="safe-ticket-chat-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleChatSubmit();
              }}
            >
              <textarea
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="왜 위험한가요?"
                rows={2}
                value={chatInput}
              />
              <button className="safe-ticket-chat-submit" disabled={!chatInput.trim() || isChatLoading} type="submit">
                {isChatLoading ? "..." : "Send"}
              </button>
            </form>

            {chatError ? <p className="safe-ticket-error">{chatError}</p> : null}
          </section>

          <section className="safe-ticket-details-stack">
              <section className="safe-ticket-card">
                <div className="safe-ticket-card-header">
                  <div>
                <h2>Parsing Result</h2>
                    <p className="safe-ticket-card-subtitle">
                      Review the extracted title, price, seller, and risk score.
                    </p>
                  </div>
                  {payload ? <span className="safe-ticket-badge ok">ready</span> : null}
                  {error ? <span className="safe-ticket-badge error">error</span> : null}
                </div>

                {payload ? (
                  <div className="safe-ticket-summary">
                    <div className="safe-ticket-summary-row">
                      <span>title</span>
                      <strong>{payload.page_title}</strong>
                    </div>

                    <div className="safe-ticket-summary-grid">
                      <div className="safe-ticket-summary-chip">
                        <span>price</span>
                        <strong>{formatPrice(payload.price)}원</strong>
                      </div>
                      <div className="safe-ticket-summary-chip">
                        <span>seller</span>
                        <strong>{payload.seller.nickname}</strong>
                      </div>
                      <div className="safe-ticket-summary-chip">
                        <span>seller id</span>
                        <strong>{payload.seller.seller_id}</strong>
                      </div>
                      <div className="safe-ticket-summary-chip">
                        <span>risk score</span>
                        <strong>{formatRiskScore(scanResult?.risk_score)}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="safe-ticket-empty">상품 상세 페이지 정보를 아직 읽지 못했습니다.</p>
                )}

                {error ? <p className="safe-ticket-error">{error}</p> : null}
              </section>

              <section className="safe-ticket-card">
                <div className="safe-ticket-card-header">
                  <div>
                    <h2>Action Guide</h2>
                    <p className="safe-ticket-card-subtitle">
                      Check what to verify next before moving forward with the trade.
                    </p>
                  </div>
                  {scanResult?.recommended_actions.length ? (
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

              <section className="safe-ticket-card safe-ticket-lookup-card">
                <div className="safe-ticket-card-header">
                  <div>
                    <h2>External Lookup</h2>
                    <p className="safe-ticket-card-subtitle">
                      External account and fraud lookups will appear here after the scan.
                    </p>
                  </div>
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
                        <div className="safe-ticket-lookup-heading">
                          <strong>{lookup.title}</strong>
                          <span>{lookup.keyword}</span>
                        </div>
                        <p>{lookup.body}</p>
                        <small>{lookup.statusLabel}</small>
                      </article>
                    ))
                  ) : (
                    <p className="safe-ticket-empty">External lookup results will appear after the scan.</p>
                  )}
                </div>
              </section>

              <section className="safe-ticket-card">
                <div className="safe-ticket-card-header">
                  <div>
                    <h2>Connection Info</h2>
                    <p className="safe-ticket-card-subtitle">
                      Check the current page source and linked service endpoints.
                    </p>
                  </div>
                </div>

                <dl className="safe-ticket-meta-list">
                  {panelContent.meta.map((item) => (
                    <div className="safe-ticket-meta-row" key={`${item.label}:${item.value}`}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </section>

          <footer className="safe-ticket-footer">
            <span>{getHostLabel(pageUrl)}</span>
          </footer>
        </div>
      ) : null}

      {!isCollapsed ? (
        <button
          aria-label="Resize panel"
          className="safe-ticket-resize-handle"
          onPointerDown={beginResize}
          type="button"
        />
      ) : null}
    </aside>
  );
}
