import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), pdf: vi.fn(), quota: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/rateLimit', () => ({ rateLimit: mocks.quota }));
vi.mock('@/server/recon/reportFacts', () => ({ loadReconReportFacts: mocks.load }));
vi.mock('@/server/recon/reportPdf', () => ({ renderReconReportPdf: mocks.pdf }));
vi.mock('@/lib/reconReportModel', () => ({ buildReconReportModel: () => ({}) }));
import { GET } from '@/app/api/recon/runs/[id]/report/pdf/route';
import { activePdfExports, pdfExportCapacity, PDF_USER_LIMIT } from '@/server/recon/pdfExportGate';

const facts = { program: { companyName: 'Acme' }, run: { startedAt: '2026-11-14T00:00:00.000Z', createdAt: '2026-11-14T00:00:00.000Z' } };
const call = (id = 'run1') => GET(new Request('http://app.test/api/recon/runs/' + id + '/report/pdf'), { params: Promise.resolve({ id }) });

describe('PDF export saturation (M4)', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: 'owner' } }); mocks.load.mockResolvedValue(facts); mocks.quota.mockResolvedValue({ status: 'ALLOWED', remaining: 5, resetSec: 600 }); });
  afterEach(() => vi.unstubAllEnvs());
  it('renders at most one PDF at a time and answers 429 instead of queueing', async () => {
    let finish!: () => void;
    mocks.pdf.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(Buffer.from('%PDF')); }));
    const first = call();
    await vi.waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(1));
    const second = await call();
    expect(second.status).toBe(429);
    expect(second.headers.get('Retry-After')).toBe('5');
    expect(mocks.pdf).toHaveBeenCalledTimes(1);
    finish();
    expect((await first).status).toBe(200);
    expect(activePdfExports()).toBe(0);
  });
  it('releases capacity when rendering fails', async () => {
    mocks.pdf.mockRejectedValueOnce(new Error('chromium crashed'));
    expect((await call()).status).toBe(503);
    expect(activePdfExports()).toBe(0);
    mocks.pdf.mockResolvedValueOnce(Buffer.from('%PDF'));
    expect((await call()).status).toBe(200);
  });
  it('applies a per-user window before launching Chromium', async () => {
    mocks.quota.mockResolvedValue({ status: 'BLOCKED', remaining: 0, resetSec: 321 });
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('321');
    expect(mocks.quota).toHaveBeenCalledWith('rl:pdf-export:owner', PDF_USER_LIMIT.limit, PDF_USER_LIMIT.windowSec);
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it('keeps the hard concurrency bound when the shared limiter is unavailable', async () => {
    mocks.quota.mockResolvedValue({ status: 'UNAVAILABLE' });
    mocks.pdf.mockResolvedValueOnce(Buffer.from('%PDF'));
    expect((await call()).status).toBe(200);
  });
  it('checks identifiers and ownership before taking capacity', async () => {
    expect((await call('../../etc')).status).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
  });
  it('bounds configured concurrency to 1..4', () => {
    expect(pdfExportCapacity({})).toBe(1);
    expect(pdfExportCapacity({ PDF_EXPORT_MAX_CONCURRENCY: '3' })).toBe(3);
    for (const bad of ['0', '5', 'x', '2.5']) expect(pdfExportCapacity({ PDF_EXPORT_MAX_CONCURRENCY: bad })).toBe(1);
  });
});
