import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { rateLimit } from '@/lib/rateLimit';

export const PDF_USER_LIMIT = { limit: 6, windowSec: 600 } as const;
export const PDF_LEASE_MS = 90_000;
export const PDF_LEASE_KEY = 'capacity:pdf:v2';
// Expired owners are quarantined, never automatically recycled: a crashed
// client cannot prove rendering stopped. Operator cleanup requires destruction
// of the browser container. The hash is bounded by capacity + one config field.
export const PDF_ACQUIRE_SCRIPT = `
local capacity = redis.call('HGET', KEYS[1], 'capacity')
if capacity and capacity ~= ARGV[1] then return -1 end
local count = redis.call('HLEN', KEYS[1])
if count - (capacity and 1 or 0) >= tonumber(ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], 'capacity', ARGV[1], ARGV[2], ARGV[3])
return 1
`;
export const PDF_RELEASE_SCRIPT = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
 return redis.call('HDEL', KEYS[1], ARGV[1])
end
return 0
`;
export function pdfExportCapacity(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.PDF_EXPORT_MAX_CONCURRENCY ?? 1);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1;
}
export async function pdfLeaseCommand(script: string, ...args: (string | number)[]) {
  if (!process.env.REDIS_URL) throw new Error('PDF capacity requires explicit Redis configuration');
  const client = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 500, commandTimeout: 750, retryStrategy: () => null });
  client.on('error', () => {});
  try {
    await client.connect();
    // A lost Redis reservation must not admit a second live renderer after a
    // restart. Require synchronous durable AOF and no eviction, or fail closed.
    const config = await client.config('GET', 'appendonly', 'appendfsync', 'maxmemory-policy') as string[];
    const values = Object.fromEntries(Array.from({ length: config.length / 2 }, (_, i) => [config[i * 2], config[i * 2 + 1]]));
    if (values.appendonly !== 'yes' || values.appendfsync !== 'always' || values['maxmemory-policy'] !== 'noeviction') throw new Error('PDF capacity requires durable non-evicting Redis');
    return Number(await client.eval(script, 1, PDF_LEASE_KEY, ...args));
  }
  finally { client.disconnect(); }
}
export type PdfAdmission = { admitted: true; owner: string; expiresAt: number; release: () => Promise<void> } | { admitted: false; retryAfterSec: number; reason: 'BUSY' | 'RATE_LIMITED' | 'UNAVAILABLE' };
export async function admitPdfExport(userId: string, limiter = rateLimit, command = pdfLeaseCommand): Promise<PdfAdmission> {
  const quota = await limiter('rl:pdf-export:' + userId, PDF_USER_LIMIT.limit, PDF_USER_LIMIT.windowSec);
  if (quota.status === 'BLOCKED') return { admitted: false, retryAfterSec: quota.resetSec, reason: 'RATE_LIMITED' };
  if (quota.status === 'UNAVAILABLE') return { admitted: false, retryAfterSec: 5, reason: 'UNAVAILABLE' };
  const owner = randomUUID(), expiresAt = Date.now() + PDF_LEASE_MS;
  const value = JSON.stringify({ owner, expiresAt, pid: process.pid });
  try {
    const result = await command(PDF_ACQUIRE_SCRIPT, pdfExportCapacity(), owner, value);
    if (result !== 1) return { admitted: false, retryAfterSec: 5, reason: result === 0 ? 'BUSY' : 'UNAVAILABLE' };
  } catch { return { admitted: false, retryAfterSec: 5, reason: 'UNAVAILABLE' }; }
  let released = false;
  return { admitted: true, owner, expiresAt, release: async () => {
    if (!released) { await command(PDF_RELEASE_SCRIPT, owner, value); released = true; }
  } };
}
