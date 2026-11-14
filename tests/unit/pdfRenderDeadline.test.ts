import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('@/server/isolatedBrowser', () => ({ launchIsolatedBrowser: mocks.launch }));
vi.mock('@/lib/reconReportHtml', () => ({ renderReconReportHtml: () => '<p>fixture</p>' }));
import { renderReconReportPdf, PDF_RENDER_DEADLINE_MS } from '@/server/recon/reportPdf';
import type { ReconReportModel } from '@/lib/reconReportModel';
describe('PDF render deadline and confirmed termination', () => {
  afterEach(() => vi.useRealTimers());
  it('awaits process termination even when the renderer never answers', async () => {
    vi.useFakeTimers();
    let terminated!: () => void;
    const close = vi.fn(() => new Promise<void>(resolve => { terminated = resolve; }));
    const page = { route: vi.fn(), setContent: vi.fn(), pdf: vi.fn(() => new Promise(() => {})) };
    mocks.launch.mockResolvedValue({ close, newContext: async () => ({ newPage: async () => page }) });
    let completed = false;
    const render = renderReconReportPdf({} as ReconReportModel).finally(() => { completed = true; });
    const rejected = expect(render).rejects.toThrow(/deadline/);
    await vi.advanceTimersByTimeAsync(PDF_RENDER_DEADLINE_MS + 1);
    expect(close).toHaveBeenCalledOnce(); expect(completed).toBe(false);
    terminated(); await rejected; expect(completed).toBe(true);
  });
});
