const LOCAL_API_BASE_URL = "http://127.0.0.1:8000";
const LOCAL_FRONTEND_BASE_URL = "http://localhost:3000";
const FRONTEND_PORT = "3000";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function isLoopbackUrl(value: string): boolean {
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readViteEnv(name: string): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function getCurrentHostname(): string {
  if (typeof window === "undefined") {
    return "127.0.0.1";
  }

  return window.location.hostname || "127.0.0.1";
}

function isHostedSafeTicketPage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const hostname = getCurrentHostname();
  return hostname === "localhost" || hostname === "127.0.0.1" || window.location.port === FRONTEND_PORT;
}

function isPublicHostedSafeTicketPage(): boolean {
  return isHostedSafeTicketPage() && !isLoopbackHostname(getCurrentHostname());
}

export function buildDefaultApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return LOCAL_API_BASE_URL;
  }

  const hostname = getCurrentHostname();
  const isHostedSafeTicketPage =
    hostname === "localhost" || hostname === "127.0.0.1" || window.location.port === FRONTEND_PORT;

  if (isHostedSafeTicketPage) {
    const protocol = window.location.protocol || "http:";
    return `${protocol}//${hostname}:8000`;
  }

  return LOCAL_API_BASE_URL;
}

export function buildDefaultFrontendBaseUrl(): string {
  if (typeof window === "undefined") {
    return LOCAL_FRONTEND_BASE_URL;
  }

  const hostname = window.location.hostname || "127.0.0.1";
  const isHostedSafeTicketPage =
    hostname === "localhost" || hostname === "127.0.0.1" || window.location.port === FRONTEND_PORT;

  if (isHostedSafeTicketPage) {
    return `${window.location.protocol}//${window.location.host}`;
  }

  return LOCAL_FRONTEND_BASE_URL;
}

export function resolveApiBaseUrl(configuredUrl?: string): string {
  if (configuredUrl && !(isPublicHostedSafeTicketPage() && isLoopbackUrl(configuredUrl))) {
    return trimTrailingSlash(configuredUrl);
  }

  return trimTrailingSlash(buildDefaultApiBaseUrl());
}

export function resolveFrontendBaseUrl(configuredUrl?: string): string {
  if (configuredUrl && !(isPublicHostedSafeTicketPage() && isLoopbackUrl(configuredUrl))) {
    return trimTrailingSlash(configuredUrl);
  }

  return trimTrailingSlash(buildDefaultFrontendBaseUrl());
}

export function getSafeTicketApiBaseUrl(): string {
  return resolveApiBaseUrl(readViteEnv("VITE_SAFE_TICKET_API_BASE_URL"));
}

export function getSafeTicketFrontendBaseUrl(): string {
  return resolveFrontendBaseUrl(readViteEnv("VITE_SAFE_TICKET_FRONTEND_BASE_URL"));
}
