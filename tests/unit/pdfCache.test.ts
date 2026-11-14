import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedPdf, cachePdf, pdfCacheKey } from '@/server/recon/pdfCache';
describe('bounded PDF cache', () => {
  afterEach(() => vi.useRealTimers());
  it('separates owners and models, expires after 60 seconds and bounds retained bytes', () => {
    vi.useFakeTimers();
    const key = pdfCacheKey('owner1', { run: 'one' });
    expect(key).not.toBe(pdfCacheKey('owner2', { run: 'one' }));
    expect(key).not.toBe(pdfCacheKey('owner1', { run: 'two' }));
    cachePdf(key, Buffer.from('%PDF'));
    expect(cachedPdf(key)?.toString()).toBe('%PDF');
    vi.advanceTimersByTime(60_001); expect(cachedPdf(key)).toBeUndefined();
    for (let i = 0; i < 3; i++) cachePdf('large-' + i, Buffer.alloc(8 * 1024 * 1024));
    expect(cachedPdf('large-0')).toBeUndefined();
    expect(cachedPdf('large-1')?.length).toBe(8 * 1024 * 1024);
    cachePdf('oversize', Buffer.alloc(17 * 1024 * 1024));
    expect(cachedPdf('oversize')).toBeUndefined();
    vi.advanceTimersByTime(60_001);
  });
});
