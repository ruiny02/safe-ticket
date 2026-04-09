import { useEffect, useState } from "react";

import { buildScanPayload, parseJoongnaProductHtml } from "../../shared/joonggonara";
import { createScan, getScan } from "../../shared/scan-api";
import type { ScanCreateRequest, ScanQueuedResponse, ScanResultResponse } from "../../shared/types";
import { applyPageHighlights, clearPageHighlights } from "./lib/highlight";
import { buildPanelContent } from "./lib/panel-content";

const API_BASE_URL = "http://localhost:8000";

interface AppProps {
  pageHtml: string;
  pageUrl: string;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("ko-KR").format(price);
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

export function App({ pageHtml, pageUrl }: AppProps) {
  const [payload, setPayload] = useState<ScanCreateRequest | null>(null);
  const [response, setResponse] = useState<ScanQueuedResponse | null>(null);
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
      setResponse(null);
      setScanResult(null);
      clearPageHighlights();
    } catch (nextError) {
      setPayload(null);
      setResponse(null);
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
      setResponse(nextResponse);
      const nextScanResult = await pollScanResult(nextResponse.scan_id, nextResponse.poll_after_ms);
      setScanResult(nextScanResult);
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

  return (
    <aside className={`safe-ticket-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <header className="safe-ticket-header">
        <div>
          <p className="safe-ticket-eyebrow">safe-ticket extension MVP</p>
          <h1>거래 페이지 스캔 패널</h1>
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

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>파싱 결과</h2>
              {payload ? <span className="safe-ticket-badge ok">ready</span> : null}
              {error ? <span className="safe-ticket-badge error">error</span> : null}
            </div>

            {payload ? (
              <dl className="safe-ticket-summary">
                <div>
                  <dt>제목</dt>
                  <dd>{payload.page_title}</dd>
                </div>
                <div>
                  <dt>가격</dt>
                  <dd>{formatPrice(payload.price)}원</dd>
                </div>
                <div>
                  <dt>판매자</dt>
                  <dd>
                    {payload.seller.nickname} / {payload.seller.seller_id}
                  </dd>
                </div>
              </dl>
            ) : null}

            {error ? <p className="safe-ticket-error">{error}</p> : null}

            <div className="safe-ticket-actions">
              <button className="safe-ticket-primary" onClick={handleParse} type="button">
                다시 파싱
              </button>
              <button
                className="safe-ticket-secondary"
                disabled={!payload || isSending}
                onClick={() => void handleSubmit()}
                type="button"
              >
                {isSending ? "전송 중..." : "백엔드로 전송"}
              </button>
            </div>
          </section>

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>문제 이유</h2>
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
                  응답이 아직 없거나, 현재 규칙 기준에서 강조할 의심 문구가 없습니다.
                </p>
              )}
            </div>
          </section>

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>권장 확인 사항</h2>
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

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>운영 정보</h2>
              <span className="safe-ticket-badge ok">local demo</span>
            </div>
            <dl className="safe-ticket-meta-list">
              {panelContent.meta.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>기술 세부</h2>
              {response ? <span className="safe-ticket-badge ok">accepted</span> : null}
            </div>
            <details className="safe-ticket-details" open={Boolean(error)}>
              <summary>Payload Preview</summary>
              <pre>{payload ? JSON.stringify(payload, null, 2) : "파싱 결과가 없습니다."}</pre>
            </details>
            <details className="safe-ticket-details" open={Boolean(error)}>
              <summary>Scan Response</summary>
              <pre>
                {scanResult
                  ? JSON.stringify(scanResult, null, 2)
                  : response
                    ? JSON.stringify(response, null, 2)
                    : "전송 후 백엔드 응답이 여기에 표시됩니다."}
              </pre>
            </details>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
