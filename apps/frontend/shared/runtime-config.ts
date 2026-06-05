const LOCAL_API_BASE_URL = "http://127.0.0.1:8000";
const LOCAL_FRONTEND_BASE_URL = "http://localhost:3000";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readViteEnv(name: string): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function buildDefaultApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return LOCAL_API_BASE_URL;
  }

  const hostname = window.location.hostname || "127.0.0.1";
  const isLocalPreviewHost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "54.180.226.121";

  if (!isLocalPreviewHost) {
    return LOCAL_API_BASE_URL;
  }

  const protocol = window.location.protocol || "http:";
  return `${protocol}//${hostname}:8000`;
}

export function buildDefaultFrontendBaseUrl(): string {
  if (typeof window === "undefined") {
    return LOCAL_FRONTEND_BASE_URL;
  }

  const hostname = window.location.hostname || "127.0.0.1";
  const isLocalPreviewHost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "54.180.226.121";

  if (!isLocalPreviewHost) {
    return LOCAL_FRONTEND_BASE_URL;
  }

  return `${window.location.protocol}//${window.location.host}`;
}

export function getSafeTicketApiBaseUrl(): string {
  return trimTrailingSlash(readViteEnv("VITE_SAFE_TICKET_API_BASE_URL") ?? buildDefaultApiBaseUrl());
}

export function getSafeTicketFrontendBaseUrl(): string {
  return trimTrailingSlash(
    readViteEnv("VITE_SAFE_TICKET_FRONTEND_BASE_URL") ?? buildDefaultFrontendBaseUrl(),
  );
}
