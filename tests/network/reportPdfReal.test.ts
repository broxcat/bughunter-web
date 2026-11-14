import { describe, expect, it } from 'vitest';
import { renderReconReportPdf } from '@/server/recon/reportPdf';
import { buildReconReportModel, type ReportFacts } from '@/lib/reconReportModel';

// Real Chromium (H1/M4): sandboxed, scrubbed environment, network blocked.
const facts: ReportFacts = {
  run: { id: 'run1', status: 'COMPLETED', outcome: 'SUCCESS', createdAt: '2026-11-05T12:00:00Z', startedAt: '2026-11-05T12:00:00Z', finishedAt: '2026-11-05T12:05:00Z' },
  program: { companyName: 'Acme <script>alert(1)</script>', platform: 'HACKERONE', requiredUserAgent: 'BugHunter/1.0', outOfScope: [], rulesOfEngagement: null, assessmentMode: 'BLACK_BOX' },
  authorizedAssets: ['acme.example'], scans: [], authSurfaces: [],
} as unknown as ReportFacts;
const suite = process.env.SCANNER_HTTP_TESTS === '1' ? describe : describe.skip;
suite('real PDF rendering with the hardened browser', () => {
  it('produces a PDF from escaped content with the sandboxed browser', async () => {
    const pdf = await renderReconReportPdf(buildReconReportModel(facts));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  }, 60000);
});
