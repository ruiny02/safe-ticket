import { type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

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
import { getSafeTicketApiBaseUrl, getSafeTicketFrontendBaseUrl } from "../../shared/runtime-config";
import { createScan, getScan } from "../../shared/scan-api";
import type { ScanCreateRequest, ScanHighlightTarget, ScanResultResponse } from "../../shared/types";
import { buildLocalChatHighlightTargets, mergeHighlightTargets } from "./lib/chat-rules";
import { buildAssistantReply, buildSuggestedPrompts } from "./lib/chatbot";
import {
  PANEL_COLLAPSED_WIDTH,
  clampPanelRect,
  createDefaultPanelRect,
  movePanel,
  resizePanel,
  type PanelRect,
} from "./lib/floating-panel";
import { applyPageHighlights, clearPageHighlights } from "./lib/highlight";
import { buildPanelContent } from "./lib/panel-content";
import {
  buildDashboardBaseUrl,
  buildDashboardPageUrl,
  buildReportListUrl,
  buildReportPageUrl,
} from "./lib/report-link";

const API_BASE_URL = getSafeTicketApiBaseUrl();
const FRONTEND_BASE_URL = getSafeTicketFrontendBaseUrl();
const LATEST_SCAN_STORAGE_KEY = "safeTicketLatestScan";
const USER_PROFILE_STORAGE_KEY = "safeTicketUserProfile";
const SAFE_TICKET_ICON_PATH = "icons/safe-ticket-icon-128.png";

interface AppProps {
  pageUrl: string;
}

type PanelTab = "analysis" | "chat";

interface PanelPreferences {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PanelInteraction =
  | {
      type: "drag";
      pointerId: number;
      originX: number;
      originY: number;
      originRect: PanelRect;
    }
  | {
      type: "resize";
      pointerId: number;
      originX: number;
      originY: number;
      originRect: PanelRect;
    }
  | null;

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

function formatRiskLevelLabel(riskLevel: ScanResultResponse["risk_level"] | null | undefined): string {
  if (riskLevel === "high") {
    return "높은 위험도";
  }

  if (riskLevel === "medium") {
    return "중간 위험도";
  }

  if (riskLevel === "low") {
    return "낮은 위험도";
  }

  return "위험도 분석 대기";
}

function getHostLabel(pageUrl: string): string {
  try {
    return new URL(pageUrl).host;
  } catch {
    return pageUrl;
  }
}

function loadPanelPreferences(): PanelRect {
  try {
    const raw = window.localStorage.getItem("safeTicketPanelRect");
    if (!raw) {
      return createDefaultPanelRect(window.innerWidth, window.innerHeight);
    }

    const parsed = JSON.parse(raw) as Partial<PanelPreferences>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return createDefaultPanelRect(window.innerWidth, window.innerHeight);
    }

    return clampPanelRect(parsed as PanelRect, window.innerWidth, window.innerHeight);
  } catch {
    return createDefaultPanelRect(window.innerWidth, window.innerHeight);
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
      frontendBaseUrl: FRONTEND_BASE_URL,
    },
  });
}

async function loadStoredUserProfile(): Promise<ScanCreateRequest["user_profile"]> {
  const extensionApi = (globalThis as typeof globalThis & {
    chrome?: {
      storage?: {
        local?: {
          get: (keys: string | string[]) => Promise<Record<string, unknown>>;
        };
      };
    };
  }).chrome;

  const storageApi = extensionApi?.storage?.local;
  if (!storageApi) {
    return null;
  }

  const stored = await storageApi.get(USER_PROFILE_STORAGE_KEY);
  const rawProfile = stored[USER_PROFILE_STORAGE_KEY];
  if (!rawProfile || typeof rawProfile !== "object") {
    return null;
  }

  const nextProfile = rawProfile as {
    age?: unknown;
    trade_experience_level?: unknown;
  };
  const age = typeof nextProfile.age === "number" && Number.isFinite(nextProfile.age) ? nextProfile.age : null;
  const tradeExperienceLevel =
    nextProfile.trade_experience_level === "beginner" ||
    nextProfile.trade_experience_level === "intermediate" ||
    nextProfile.trade_experience_level === "advanced"
      ? nextProfile.trade_experience_level
      : null;

  if (age === null && tradeExperienceLevel === null) {
    return null;
  }

  return {
    age,
    trade_experience_level: tradeExperienceLevel,
  };
}

export function App({ pageUrl }: AppProps) {
  const parseRequestIdRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const [payload, setPayload] = useState<ScanCreateRequest | null>(null);
  const [currentPageUrl, setCurrentPageUrl] = useState(pageUrl);
  const [scanResult, setScanResult] = useState<ScanResultResponse | null>(null);
  const [localHighlightTargets, setLocalHighlightTargets] = useState<ScanHighlightTarget[]>([]);
  const [appliedHighlights, setAppliedHighlights] = useState<ScanHighlightTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>("analysis");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatSource, setChatSource] = useState<"local" | "remote">("local");
  const [panelRect, setPanelRect] = useState<PanelRect>(() => loadPanelPreferences());
  const [panelInteraction, setPanelInteraction] = useState<PanelInteraction>(null);

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
    apiBaseUrl: API_BASE_URL,
    dashboardUrl: buildDashboardBaseUrl(),
    reportUrl: buildReportListUrl(),
  });
  const chatSuggestions = buildSuggestedPrompts(payload, visibleScanResult);
  const heroTitle = visibleScanResult ? "스캔 결과" : payload ? "스캔 준비" : "페이지 확인 중";
  const heroRiskLabel = formatRiskLevelLabel(visibleScanResult?.risk_level ?? null);
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
      const storedUserProfile = await loadStoredUserProfile();
      const requestPayload: ScanCreateRequest = {
        ...payload,
        user_profile: storedUserProfile,
      };
      const nextResponse = await createScan(API_BASE_URL, requestPayload);
      const nextScanResult = await pollScanResult(nextResponse.scan_id, nextResponse.poll_after_ms);

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
    window.localStorage.setItem("safeTicketPanelRect", JSON.stringify(panelRect));
  }, [panelRect]);

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
    if (!panelInteraction) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== panelInteraction.pointerId) {
        return;
      }

      const deltaX = event.clientX - panelInteraction.originX;
      const deltaY = event.clientY - panelInteraction.originY;

      setPanelRect((current) =>
        panelInteraction.type === "drag"
          ? movePanel(panelInteraction.originRect, deltaX, deltaY, window.innerWidth, window.innerHeight)
          : resizePanel(panelInteraction.originRect, deltaX, deltaY, window.innerWidth, window.innerHeight),
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== panelInteraction.pointerId) {
        return;
      }

      setPanelInteraction(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [panelInteraction]);

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

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (isCollapsed) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button")) {
      return;
    }

    event.preventDefault();
    setPanelInteraction({
      type: "drag",
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      originRect: panelRect,
    });
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setPanelInteraction({
      type: "resize",
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      originRect: panelRect,
    });
  };

  const handleBrandPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isCollapsed) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setPanelInteraction({
      type: "drag",
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      originRect: panelRect,
    });
  };

  return (
    <aside
      className={`safe-ticket-panel ${isCollapsed ? "is-collapsed" : ""} ${panelInteraction ? "is-interacting" : ""}`}
      onPointerDown={isCollapsed ? handleHeaderPointerDown : undefined}
      ref={panelRef}
      style={{
        left: `${panelRect.x}px`,
        top: `${panelRect.y}px`,
        width: isCollapsed ? `${PANEL_COLLAPSED_WIDTH}px` : `${panelRect.width}px`,
        height: isCollapsed ? "auto" : `${panelRect.height}px`,
      }}
    >
<header className="safe-ticket-header" onPointerDown={handleHeaderPointerDown}>
        <div
          className="safe-ticket-brand"
          onPointerDown={(event) => {
            if (isCollapsed) {
              handleBrandPointerDown(event);
            }
          }}
        >
          <span
            aria-hidden="true"
            className="safe-ticket-brand-mark"
            style={{
              backgroundImage: `linear-gradient(135deg, rgba(132, 112, 255, 0.26), rgba(111, 92, 243, 0.12)), url("${getExtensionAssetUrl(SAFE_TICKET_ICON_PATH)}")`,
            }}
          />
          <div>
            <p className="safe-ticket-eyebrow">SAFE-TICKET</p>
          </div>
        </div>
        <div className="safe-ticket-header-actions">
          <button
            className="safe-ticket-icon-button"
            onClick={() => setIsCollapsed((value) => !value)}
            type="button"
          >
            {isCollapsed ? "열기" : "접기"}
          </button>
        </div>
      </header>

      {!isCollapsed ? (
        <>
          <div className="safe-ticket-body" ref={bodyRef}>
            <section className={`safe-ticket-hero tone-${panelContent.tone}`}>
              <div className="safe-ticket-hero-copy">
                <p className="safe-ticket-hero-status">{panelContent.statusLabel}</p>
                <h2>{visibleScanResult ? `${heroTitle}: ${heroRiskLabel}` : heroTitle}</h2>
              </div>
              <div className="safe-ticket-hero-score">
                <span>risk</span>
                <strong>{formatRiskScore(visibleScanResult?.risk_score)}</strong>
              </div>
            </section>

            <section className="safe-ticket-cta-row is-split">
              <button
                className="safe-ticket-primary"
                disabled={!payload || isSending}
                onClick={() => void handleSubmit()}
                type="button"
              >
                {isSending ? "스캔 중..." : "Scan"}
              </button>
              <button className="safe-ticket-tertiary" onClick={handleParse} type="button">
                Re-read
              </button>
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
                    Dashboard
                  </a>
                  <a
                    className="safe-ticket-primary safe-ticket-link-button safe-ticket-report-cta"
                    href={buildReportPageUrl(visibleScanResult.scan_id)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Report
                  </a>
                </>
              ) : (
                <>
                  <span
                    aria-disabled="true"
                    className="safe-ticket-secondary safe-ticket-link-button safe-ticket-report-cta is-disabled"
                  >
                    Dashboard
                  </span>
                  <span
                    aria-disabled="true"
                    className="safe-ticket-primary safe-ticket-link-button safe-ticket-report-cta is-disabled"
                  >
                    Report
                  </span>
                </>
              )}
            </section>

            {activePanelTab === "analysis" ? (
              <>
                <section className="safe-ticket-card safe-ticket-card-stable safe-ticket-lookup-card">
                  <div className="safe-ticket-card-header">
                    <h2>외부 조회</h2>
                    {panelContent.externalLookups.length ? (
                      <span className="safe-ticket-badge ok">{panelContent.externalLookups.length} checks</span>
                    ) : visibleScanResult ? (
                      <span className="safe-ticket-badge neutral">not run</span>
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
                        {visibleScanResult
                          ? "이번 스캔에서는 계좌번호나 전화번호가 감지되지 않아 경찰청/더치트 외부 조회를 실행하지 않았습니다."
                          : "스캔 완료 후 외부 조회 대상이 감지되면 경찰청/더치트 조회 결과가 여기에 표시됩니다."}
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
                          <span>가격</span>
                          <strong>{formatPrice(payload.price)}원</strong>
                        </div>
                        <div className="safe-ticket-summary-chip">
                          <span>판매자</span>
                          <strong>{payload.seller.nickname}</strong>
                        </div>
                      </div>
                      <div className="safe-ticket-signal-summary">
                        <span>신뢰 지표</span>
                        {payload.marketplace_signals.length ? (
                          <ul className="safe-ticket-signal-detail-list">
                            {payload.marketplace_signals.map((signal) => (
                              <li key={`${signal.key}:${signal.value}`}>
                                <strong>{signal.label}</strong>
                                <span>{signal.value}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="safe-ticket-empty">현재 읽은 신뢰 지표가 없습니다.</p>
                        )}
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
            <nav className="safe-ticket-tab-row safe-ticket-footer-tabs" aria-label="safe-ticket panel tabs">
              <button
                className={`safe-ticket-tab ${activePanelTab === "analysis" ? "is-active" : ""}`}
                onClick={() => setActivePanelTab("analysis")}
                type="button"
              >
                Analysis
              </button>
              <button
                className={`safe-ticket-tab ${activePanelTab === "chat" ? "is-active" : ""}`}
                onClick={() => setActivePanelTab("chat")}
                type="button"
              >
                AI Chat
              </button>
            </nav>
          </footer>
        </>
      ) : null}
      {!isCollapsed ? (
        <button
          aria-label="Resize panel"
          className="safe-ticket-resize-handle"
          onPointerDown={handleResizePointerDown}
          type="button"
        />
      ) : null}
    </aside>
  );
}
