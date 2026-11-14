import { createHash } from 'node:crypto';
const MAX_BYTES = 16 * 1024 * 1024, MAX_ENTRIES = 8, TTL_MS = 60_000;
const entries = new Map<string, { bytes: Buffer; expiresAt: number }>();
let total = 0;
export const pdfCacheKey = (userId: string, model: unknown) => createHash('sha256').update(userId).update('\0').update(JSON.stringify(model)).digest('hex');
function remove(key: string) { const old = entries.get(key); if (old) total -= old.bytes.length; entries.delete(key); }
export function cachedPdf(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.expiresAt <= Date.now()) { remove(key); return; }
  entries.delete(key); entries.set(key, entry); return entry.bytes;
}
export function cachePdf(key: string, bytes: Buffer) {
  for (const [k, entry] of entries) if (entry.expiresAt <= Date.now()) remove(k);
  remove(key);
  if (bytes.length > MAX_BYTES) return;
  while (entries.size >= MAX_ENTRIES || total + bytes.length > MAX_BYTES) remove(entries.keys().next().value!);
  entries.set(key, { bytes, expiresAt: Date.now() + TTL_MS }); total += bytes.length;
}
