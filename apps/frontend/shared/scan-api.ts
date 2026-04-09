import type { ScanCreateRequest, ScanQueuedResponse, ScanResultResponse } from "./types";

export async function createScan(
  baseUrl: string,
  payload: ScanCreateRequest,
): Promise<ScanQueuedResponse> {
  const response = await fetch(`${baseUrl}/api/v1/scans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Scan request failed: ${response.status} ${detail}`);
  }

  return (await response.json()) as ScanQueuedResponse;
}

export async function getScan(baseUrl: string, scanId: string): Promise<ScanResultResponse> {
  const response = await fetch(`${baseUrl}/api/v1/scans/${scanId}`);

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Scan polling failed: ${response.status} ${detail}`);
  }

  return (await response.json()) as ScanResultResponse;
}
