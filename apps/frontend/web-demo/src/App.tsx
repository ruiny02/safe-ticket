import { useEffect, useState } from "react";

import { buildScanPayload, parseJoongnaProductHtml } from "../../shared/joonggonara";
import { createScan } from "../../shared/scan-api";
import type { ScanCreateRequest, ScanQueuedResponse } from "../../shared/types";

const API_BASE_URL = "http://localhost:8000";

interface AppProps {
  pageHtml: string;
  pageUrl: string;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("ko-KR").format(price);
}

export function App({ pageHtml, pageUrl }: AppProps) {
  const [payload, setPayload] = useState<ScanCreateRequest | null>(null);
  const [response, setResponse] = useState<ScanQueuedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handleParse = () => {
    setError(null);

    try {
      const nextPayload = buildScanPayload(parseJoongnaProductHtml(pageHtml, pageUrl));
      setPayload(nextPayload);
      setResponse(null);
    } catch (nextError) {
      setPayload(null);
      setResponse(null);
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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown submit error");
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    handleParse();
  }, [pageHtml, pageUrl]);

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
              <h2>Payload Preview</h2>
              {response ? <span className="safe-ticket-badge ok">accepted</span> : null}
            </div>
            <pre>{payload ? JSON.stringify(payload, null, 2) : "파싱 결과가 없습니다."}</pre>
          </section>

          <section className="safe-ticket-card">
            <div className="safe-ticket-card-header">
              <h2>Scan Response</h2>
            </div>
            <pre>
              {response
                ? JSON.stringify(response, null, 2)
                : "전송 후 백엔드 응답이 여기에 표시됩니다."}
            </pre>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
