import { createHash } from "node:crypto";
import type { ProbeResult } from "@/server/scanners/http";

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
export function usefulResponse(r: ProbeResult): boolean {
  return !r.error && r.status === 200 && r.bodyLen >= 24 && r.bodyLen < 65536 && !/(?:<input[^>]*type=["']password|<title>[^<]*(?:login|not found|error)|"(?:error|errors)"\s*:|unauthorized|access denied|permission denied)/i.test(r.body);
}
export function sameResponse(a: ProbeResult, b: ProbeResult): boolean {
  return usefulResponse(a) && usefulResponse(b) && a.headers["content-type"]?.split(";")[0] === b.headers["content-type"]?.split(";")[0] && bodyHash(a.body) === bodyHash(b.body);
}
export function hasObjectMarker(r: ProbeResult): boolean {
  return /application\/json|\+json/i.test(r.headers["content-type"] ?? "") && /"(?:id|ownerId|owner_id|userId|user_id|documentId|document_id)"\s*:\s*(?:"[^"\s]+"|\d+)/.test(r.body);
}
export function safeResponseEvidence(r: ProbeResult) {
  return { status: r.status, contentType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test((r.headers["content-type"] ?? "").split(";")[0]) ? (r.headers["content-type"] ?? "").split(";")[0] : "unknown", bytes: r.bodyLen, bodyHash: bodyHash(r.body), error: Boolean(r.error) };
}
/** Interleaved paired controls: a slow sample or common drift is never proof. */
export function assessPairedTiming(baselines: number[], probes: number[], confirmationBaselines: number[], confirmationProbes: number[], expectedFirstMs = 3000, expectedConfirmationMs = 5000): boolean {
  if ([baselines, probes, confirmationBaselines, confirmationProbes].some(a => a.length < 3 || a.some(v => !Number.isFinite(v) || v < 0))) return false;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const spread = (a: number[]) => Math.sqrt(avg(a.map(v => (v - avg(a)) ** 2)));
  const delta = (a: number[], b: number[]) => b.map((v, i) => v - a[i]);
  const d1 = delta(baselines, probes), d2 = delta(confirmationBaselines, confirmationProbes);
  const noise = Math.max(spread(baselines), spread(confirmationBaselines), spread(d1), spread(d2));
  return d1.every(v => v >= expectedFirstMs * 0.8) && d2.every(v => v >= expectedConfirmationMs * 0.8) && avg(d1) > 3 * noise && avg(d2) > 3 * noise && avg(d2) - avg(d1) >= (expectedConfirmationMs - expectedFirstMs) * 0.75;
}
