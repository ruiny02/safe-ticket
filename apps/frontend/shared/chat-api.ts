import type { ScanCreateRequest, ScanResultResponse } from "./types";
import { buildCorsRequestInit } from "./fetch-options";

interface RelayResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body?: string;
  error?: string;
}

export interface ChatConversationMessage {
  role: "assistant" | "user";
  text: string;
}

export interface ChatRequestPayload {
  prompt: string;
  page_url: string;
  scan_id: string | null;
  listing: ScanCreateRequest | null;
  scan_result: ScanResultResponse | null;
  messages: ChatConversationMessage[];
}

export interface ChatReplyResult {
  endpoint: string | null;
  error?: string;
  reply: string | null;
  source: "local" | "remote";
}

const CHAT_ENDPOINT_PATHS = [
  "/api/v1/chat/reply",
  "/api/v1/chat",
  "/api/v1/assistant/chat",
];

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

function normalizeRemoteReply(body: unknown): string | null {
  if (typeof body === "string") {
    return body.trim() || null;
  }

  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as Record<string, unknown>;

  if (typeof candidate.reply === "string") {
    return candidate.reply;
  }

  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  if (typeof candidate.answer === "string") {
    return candidate.answer;
  }

  if (typeof candidate.content === "string") {
    return candidate.content;
  }

  if (Array.isArray(candidate.messages)) {
    for (let index = candidate.messages.length - 1; index >= 0; index -= 1) {
      const message = candidate.messages[index];

      if (!message || typeof message !== "object") {
        continue;
      }

      const nextMessage = message as Record<string, unknown>;

      if (nextMessage.role !== "assistant") {
        continue;
      }

      if (typeof nextMessage.content === "string") {
        return nextMessage.content;
      }
    }
  }

  return null;
}

function buildBaseUrlCandidates(baseUrl: string): string[] {
  const candidates = [baseUrl];

  if (baseUrl.includes("127.0.0.1")) {
    candidates.push(baseUrl.replace("127.0.0.1", "localhost"));
  } else if (baseUrl.includes("localhost")) {
    candidates.push(baseUrl.replace("localhost", "127.0.0.1"));
  }

  return Array.from(new Set(candidates));
}

export function buildChatRequestPayload(options: {
  messages: ChatConversationMessage[];
  pageUrl: string;
  payload: ScanCreateRequest | null;
  prompt: string;
  scanResult: ScanResultResponse | null;
}): ChatRequestPayload {
  const { messages, pageUrl, payload, prompt, scanResult } = options;

  return {
    prompt,
    page_url: pageUrl,
    scan_id: scanResult?.scan_id ?? null,
    listing: payload,
    scan_result: scanResult,
    messages,
  };
}

export async function requestRemoteChatReply(
  baseUrl: string,
  payload: ChatRequestPayload,
): Promise<ChatReplyResult> {
  const body = JSON.stringify(payload);
  const unsupportedStatuses = new Set([404, 405, 501]);
  let lastError: string | undefined;

  for (const candidateBaseUrl of buildBaseUrlCandidates(baseUrl)) {
    for (const endpointPath of CHAT_ENDPOINT_PATHS) {
      const url = `${candidateBaseUrl}${endpointPath}`;
      const response = await requestText(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });

      if (!response.ok) {
        if (unsupportedStatuses.has(response.status)) {
          continue;
        }

        if (response.status === 0) {
          lastError = response.error ?? "Chat request failed";
          continue;
        }

        lastError = `Chat request failed: ${response.status} ${response.body ?? ""}`.trim();
        continue;
      }

      try {
        const parsed = JSON.parse(response.body ?? "{}") as unknown;
        const reply = normalizeRemoteReply(parsed);

        if (reply) {
          return {
            source: "remote",
            reply,
            endpoint: url,
          };
        }

        lastError = "Chat API returned an unsupported response shape.";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return {
    source: "local",
    reply: null,
    endpoint: null,
    error: lastError,
  };
}
