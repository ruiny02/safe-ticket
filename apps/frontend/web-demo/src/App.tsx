import { useEffect, useState } from "react";

import { buildScanPayload, parseJoongnaProductHtml } from "../../shared/joonggonara";
import { createScan, getScan } from "../../shared/scan-api";
import type { ScanCreateRequest, ScanResultResponse } from "../../shared/types";
import { applyPageHighlights, clearPageHighlights } from "./lib/highlight";
import { buildPanelContent } from "./lib/panel-content";
import { applyPanelLayout, clearPanelLayout } from "./lib/page-layout";
import { buildReportPageUrl } from "./lib/report-link";

const API_BASE_URL = "http://localhost:8000";
const LATEST_SCAN_STORAGE_KEY = "safeTicketLatestScan";

interface AppProps {
  pageHtml: string;
  pageUrl: string;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("ko-KR").format(price);
}

function getHostLabel(pageUrl: string): string {
  try {
    return new URL(pageUrl).host;
  } catch {
    return pageUrl;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

export function App({ pageHtml, pageUrl }: AppProps) {
  const [payload, setPayload] = useState<ScanCreateRequest | null>(null);
  const [scanResult, setScanResult] = useState<ScanResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const panelContent = buildPanelContent({ pageUrl, payload, scanResult });

  const handleParse = () => {
    setError(null);

    try {
      const nextPayload = buildScanPayload(parseJoongnaProductHtml(pageHtml, pageUrl));
      setPayload(nextPayload);
      setScanResult(null);
      clearPageHighlights();
    } catch (nextError) {
      setPayload(null);
      setScanResult(null);
      clearPageHighlights();
      setError(nextError instanceof Error ? nextError.message : "Unknown parse error");
    }
  };

  const handleSubmit = async () => {
    if (!payload) {
      return;
    }

    setError(null);
    setIsSending(true);

    try {
      const nextResponse = await createScan(API_BASE_URL, payload);
      const nextScanResult = await pollScanResult(nextResponse.scan_id, nextResponse.poll_after_ms);
      setScanResult(nextScanResult);
      await persistLatestScan(pageUrl, nextScanResult.scan_id);
    } catch (nextError) {
      setScanResult(null);
      clearPageHighlights();
      setError(nextError instanceof Error ? nextError.message : "Unknown submit error");
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    handleParse();
  }, [pageHtml, pageUrl]);

  useEffect(() => {
    if (!scanResult || (scanResult.status !== "completed" && scanResult.status !== "partial")) {
      clearPageHighlights();
      return;
    }

    applyPageHighlights(scanResult.highlight_targets);

    return () => {
      clearPageHighlights();
    };
  }, [scanResult]);

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
          <span className="safe-ticket-brand-mark">S</span>
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
        <div className="safe-ticket-body">
          <section className={`safe-ticket-hero tone-${panelContent.tone}`}>
            <div className="safe-ticket-hero-copy">
              <p className="safe-ticket-hero-status">{panelContent.statusLabel}</p>
              <h2>{panelContent.headline}</h2>
              <p>{panelContent.summary}</p>
            </div>
            <div className="safe-ticket-hero-score">
              <span>risk</span>
              <strong>
                {scanResult?.risk_score !== null && scanResult?.risk_score !== undefined
                  ? `${Math.round(scanResult.risk_score * 100)}`
                  : "--"}
              </strong>
            </div>
          </section>

          {scanResult ? (
            <section className="safe-ticket-cta-row">
              <a
                className="safe-ticket-primary safe-ticket-link-button safe-ticket-report-cta"
                href={buildReportPageUrl(scanResult.scan_id)}
                rel="noreferrer"
                target="_blank"
              >
                정확한 분석 리포트 보기
              </a>
            </section>
          ) : null}

          <section className="safe-ticket-card safe-ticket-lookup-card">
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
                  <article className={`safe-ticket-lookup-row tone-${lookup.tone}`} key={`${lookup.title}-${lookup.keyword}-${lookup.statusLabel}`}>
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

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>현재 게시글</h2>
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
              </div>
            ) : null}

            {error ? <p className="safe-ticket-error">{error}</p> : null}
          </section>

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>핵심 신호</h2>
              {scanResult?.highlight_targets.length ? (
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

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>다음 행동</h2>
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

          <footer className="safe-ticket-footer">
            <span>{getHostLabel(pageUrl)}</span>
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
        </div>
      ) : null}
    </aside>
  );
}
