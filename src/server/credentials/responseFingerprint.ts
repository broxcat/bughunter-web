import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !/^(timestamp|requestId|nonce|csrfToken)$/i.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalize(v)]));
  return value;
}
export function canonicalBody(body: string): string {
  try { return JSON.stringify(canonicalize(JSON.parse(body))); }
  catch { return body.replace(/\s+/g, " ").replace(/nonce=["'][^"']+["']/g, "nonce=\"[VOLATILE]\"").trim(); }
}
export const bodyHash = (body: string) => createHash("sha256").update(canonicalBody(body)).digest("hex");
