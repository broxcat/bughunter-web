'use client';

import { useEffect, useState } from 'react';
import type { ScanSummary } from '@/lib/scanSummary';

export default function ScanSummaryPanel({ scanRunId }: { scanRunId: string }) {
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/scan-runs/${encodeURIComponent(scanRunId)}/summary`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Scan summary unavailable');
        setSummary(await response.json() as ScanSummary);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [scanRunId]);

  return <section aria-label="Scan summary" className="space-y-3 border-t border-border px-4 py-3 text-sm">
    <h3 className="font-semibold">Scan summary</h3>
    {failed && <p role="status" className="text-muted">Summary unavailable. Raw logs remain available below.</p>}
    {!summary && !failed && <p role="status" className="text-muted">Loading summary…</p>}
    {summary?.fromLegacyLogs && <p className="text-muted">Legacy history · reading recognized log formats{summary.legacyTruncated && ' from a sample'}. The scope of these observations still needs verification.</p>}
    {summary && summary.total === 0 && <p className="text-muted">No usable observation was found in this scan data. Review the raw log to verify execution.</p>}
    {summary && summary.total > 0 && <>
      <p className="text-muted">{summary.analyzed === summary.total
        ? `${summary.total} observations ${summary.fromLegacyLogs ? 'extraites' : 'enregistrées'}`
        : `${summary.analyzed} observations analyzed out of ${summary.total} recorded (sampled by type)`}.
        {!summary.fromLegacyLogs && ' Leads refer to the scope recorded during the scan. Verify the current scope before testing.'}</p>
      <h4 className="font-medium">Review first</h4>
      {summary.priorities.length ? <ol className="list-decimal space-y-2 pl-5">
        {summary.priorities.map(item => <li key={JSON.stringify([item.label, item.observation])}>
          <p className="break-words font-medium">{item.label} · {item.observation}</p>
          <p className="text-muted">{item.observed ? 'Observed' : 'Needs confirmation'} · {item.tools.join(', ')}</p>
          <p>{item.check}</p>
        </li>)}
      </ol> : <p className="text-muted">No priority lead was found in the analyzed observations.</p>}
      <p className="text-xs text-muted">Leads require manual validation before becoming findings.</p>
      <h4 className="font-medium">Discoveries by tool</h4>
      <ul className="space-y-2">
        {summary.tools.map(tool => <li key={tool.name} className="rounded border border-border px-3 py-2">
          <p className="break-words font-medium">{tool.name}</p>
          <p className="text-muted">{tool.counts.map(([kind, count]) => `${kind} × ${count}`).join(' · ')}</p>
          {tool.examples.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {tool.examples.map(item => <li key={JSON.stringify([item.label, item.observation])} className="break-words">
              {item.observation} <span className="text-muted">· {item.observed ? 'Observed' : 'Needs confirmation'}{!item.inScope && ' · Scope not established or excluded'}</span>
            </li>)}
          </ul>}
        </li>)}
      </ul>
    </>}
  </section>;
}
