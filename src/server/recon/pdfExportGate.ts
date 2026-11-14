import { rateLimit } from '@/lib/rateLimit';

/**
 * M4: each PDF export launches Chromium in the web process. A process-wide,
 * non-queuing semaphore is the hard bound (busy => 429, no pile-up), and a
 * per-user window limits repeated exports. If the shared limiter is
 * unavailable the semaphore still bounds resource use.
 */
export const PDF_USER_LIMIT = { limit: 6, windowSec: 600 } as const;
let active = 0;
export function pdfExportCapacity(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.PDF_EXPORT_MAX_CONCURRENCY ?? 1);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1;
}
export type PdfAdmission = { admitted: true; release: () => void } | { admitted: false; retryAfterSec: number; reason: 'BUSY' | 'RATE_LIMITED' };
export async function admitPdfExport(userId: string, limiter = rateLimit): Promise<PdfAdmission> {
  const quota = await limiter('rl:pdf-export:' + userId, PDF_USER_LIMIT.limit, PDF_USER_LIMIT.windowSec);
  if (quota.status === 'BLOCKED') return { admitted: false, retryAfterSec: quota.resetSec, reason: 'RATE_LIMITED' };
  if (active >= pdfExportCapacity()) return { admitted: false, retryAfterSec: 5, reason: 'BUSY' };
  active++;
  let released = false;
  return { admitted: true, release: () => { if (!released) { released = true; active--; } } };
}
export const activePdfExports = () => active;
