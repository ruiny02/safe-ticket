type LocalAddressSpaceRequestInit = RequestInit & { targetAddressSpace?: "local" };

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function shouldRequestLocalAddressSpace(url: string): boolean {
  try {
    const hostname = new URL(url, "http://localhost").hostname.toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1" || isPrivateIpv4(hostname);
  } catch {
    return false;
  }
}

export function buildCorsRequestInit(url: string, init?: RequestInit): RequestInit {
  const directInit: LocalAddressSpaceRequestInit = {
    ...init,
    mode: "cors",
  };

  if (shouldRequestLocalAddressSpace(url)) {
    directInit.targetAddressSpace = "local";
  }

  return directInit;
}
