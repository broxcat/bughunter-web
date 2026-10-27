import { isIP } from "node:net";

export type ClientIpResolution =
  | { ip: string; source: "trusted-proxy" | "direct" }
  | { ip: "unknown"; source: "unknown" };

// A malformed client prefix on an appending proxy must not switch a caller
// from an exhausted real-IP budget into a second, shared "unknown" budget.
export function isUsableClientIdentity(identity: ClientIpResolution): boolean {
  return process.env.TRUST_PROXY_HEADERS !== "true" || identity.source !== "unknown";
}

export function normalizeIp(value: string): string | null {
  const ip = value.trim();
  // No zone identifiers, ports or bracketed hosts in client IP addresses.
  if (ip.includes("%")) return null;
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/** directAddress must come from a server-owned socket, never a request header.
 * Next.js exposes no such socket: its callers intentionally share "unknown".
 */
export function resolveClientIp(req: { headers: Headers }, directAddress?: string): ClientIpResolution {
  const unknown: ClientIpResolution = { ip: "unknown", source: "unknown" };
  if (process.env.TRUST_PROXY_HEADERS !== "true") {
    const ip = directAddress && normalizeIp(directAddress);
    return ip ? { ip, source: "direct" } : unknown;
  }
  const hopsValue = process.env.TRUSTED_PROXY_HOPS ?? "1";
  if (!/^[1-9][0-9]?$/.test(hopsValue)) return unknown;
  const hops = Number(hopsValue);
  if (hops > 16) return unknown;
  const header = req.headers.get("x-forwarded-for");
  if (!header || header.length > 2048) return unknown;
  const chain = header.split(",").map(normalizeIp);
  if (chain.length > 32 || chain.length < hops || chain.some(ip => !ip)) return unknown;
  // The fixed ingress hop count is operator-owned; ignore client prefixes.
  return { ip: chain[chain.length - hops]!, source: "trusted-proxy" };
}
