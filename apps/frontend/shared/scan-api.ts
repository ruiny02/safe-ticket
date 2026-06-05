import type {
  PipelineExchangeResponse,
  ScanCreateRequest,
  ScanQueuedResponse,
  ScanResultResponse,
} from "./types";
import { buildCorsRequestInit } from "./fetch-options";

interface RelayResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body?: string;
  error?: string;
}

function hasExtensionRuntime(): boolean {
  const extensionApi = (globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        id?: string;
        lastError?: { message?: string };
        sendMessage?: (
          message: unknown,
          callback?: (response: RelayResponse | undefined) => void,
        ) => void;
      };
    };
  }).chrome;

  return Boolean(extensionApi?.runtime?.id && extensionApi.runtime.sendMessage);
}

async function relayFetch(url: string, init?: RequestInit): Promise<RelayResponse> {
  const extensionApi = (globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        lastError?: { message?: string };
        sendMessage?: (
          message: unknown,
          callback?: (response: RelayResponse | undefined) => void,
        ) => void;
      };
    };
  }).chrome;

  return new Promise<RelayResponse>((resolve, reject) => {
    extensionApi?.runtime?.sendMessage?.(
      {
        type: "safe-ticket-fetch",
        url,
        init: {
          method: init?.method ?? "GET",
          headers: init?.headers ?? {},
          body: typeof init?.body === "string" ? init.body : undefined,
        },
      },
      (response) => {
        const runtimeError = extensionApi.runtime?.lastError;
        if (runtimeError?.message) {
          reject(new Error(runtimeError.message));
          return;
        }

        if (!response) {
          reject(new Error("No response from extension background"));
          return;
        }

        resolve(response);
      },
    );
  });
}

async function requestText(url: string, init?: RequestInit): Promise<RelayResponse> {
  if (hasExtensionRuntime()) {
    try {
      const relayed = await relayFetch(url, init);
      if (relayed.ok || relayed.status !== 0) {
        return relayed;
      }
    } catch {
      // Fall through to direct fetch below.
    }
  }

  try {
    const response = await fetch(url, buildCorsRequestInit(url, init));
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function requestJson<T>(url: string, init?: RequestInit, label?: string): Promise<T> {
  const response = await requestText(url, init);

  if (!response.ok) {
    if (response.status === 0) {
      throw new Error(response.error ?? `${label ?? "Request"} failed`);
    }

    throw new Error(`${label ?? "Request"} failed: ${response.status} ${response.body ?? ""}`);
  }

  return JSON.parse(response.body ?? "{}") as T;
}

export async function createScan(
  baseUrl: string,
  payload: ScanCreateRequest,
): Promise<ScanQueuedResponse> {
  const body = JSON.stringify(payload);
  const primaryUrl = `${baseUrl}/api/v1/scans`;
  const fallbackUrl = primaryUrl.includes("127.0.0.1")
    ? primaryUrl.replace("127.0.0.1", "localhost")
    : primaryUrl.replace("localhost", "127.0.0.1");

  try {
    return await requestJson<ScanQueuedResponse>(
      primaryUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      },
      "Scan request",
    );
  } catch (error) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      try {
        return await requestJson<ScanQueuedResponse>(
          fallbackUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body,
          },
          "Scan request",
        );
      } catch {
        // Fall through to the primary error below.
      }
    }

    throw error;
  }
}

export async function createScanSync(
  baseUrl: string,
  payload: ScanCreateRequest,
): Promise<ScanResultResponse> {
  const body = JSON.stringify(payload);
  const primaryUrl = `${baseUrl}/api/v1/scans/sync`;
  const fallbackUrl = primaryUrl.includes("127.0.0.1")
    ? primaryUrl.replace("127.0.0.1", "localhost")
    : primaryUrl.replace("localhost", "127.0.0.1");

  try {
    return await requestJson<ScanResultResponse>(
      primaryUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      },
      "Sync scan request",
    );
  } catch (error) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      try {
        return await requestJson<ScanResultResponse>(
          fallbackUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body,
          },
          "Sync scan request",
        );
      } catch {
        // Fall through to the primary error below.
      }
    }

    throw error;
  }
}

export async function getScan(baseUrl: string, scanId: string): Promise<ScanResultResponse> {
  const primaryUrl = `${baseUrl}/api/v1/scans/${scanId}`;
  const fallbackUrl = primaryUrl.includes("127.0.0.1")
    ? primaryUrl.replace("127.0.0.1", "localhost")
    : primaryUrl.replace("localhost", "127.0.0.1");

  try {
    return await requestJson<ScanResultResponse>(
      primaryUrl,
      undefined,
      "Scan polling",
    );
  } catch (error) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      try {
        return await requestJson<ScanResultResponse>(
          fallbackUrl,
          undefined,
          "Scan polling",
        );
      } catch {
        // Fall through to the primary error below.
      }
    }

    throw error;
  }
}

export async function getPipelineDebug(
  baseUrl: string,
  scanId: string,
): Promise<PipelineExchangeResponse> {
  return requestJson<PipelineExchangeResponse>(
    `${baseUrl}/api/v1/scans/${scanId}/pipeline-debug`,
    undefined,
    "Pipeline debug request",
  );
}
