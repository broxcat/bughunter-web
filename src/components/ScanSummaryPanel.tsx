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

  return <section aria-label="Synthèse du scan" className="space-y-3 border-t border-border px-4 py-3 text-sm">
    <h3 className="font-semibold">Synthèse du scan</h3>
    {failed && <p role="status" className="text-muted">Synthèse indisponible. Le journal brut reste accessible ci-dessous.</p>}
    {!summary && !failed && <p role="status" className="text-muted">Chargement de la synthèse…</p>}
    {summary?.fromLegacyLogs && <p className="text-muted">Historique ancien · lecture des formats de journal reconnus{summary.legacyTruncated && ' sur un échantillon'}. Le périmètre de ces observations reste à vérifier.</p>}
    {summary && summary.total === 0 && <p className="text-muted">Aucune observation exploitable dans les données de ce scan. Consulte le journal brut pour vérifier son exécution.</p>}
    {summary && summary.total > 0 && <>
      <p className="text-muted">{summary.analyzed === summary.total
        ? `${summary.total} observations ${summary.fromLegacyLogs ? 'extraites' : 'enregistrées'}`
        : `${summary.analyzed} observations analysées sur ${summary.total} enregistrées (échantillon par type)`}.
        {!summary.fromLegacyLogs && ' Les pistes concernent le périmètre enregistré pendant le scan. Vérifie le périmètre actuel avant de tester.'}</p>
      <h4 className="font-medium">À examiner en priorité</h4>
      {summary.priorities.length ? <ol className="list-decimal space-y-2 pl-5">
        {summary.priorities.map(item => <li key={JSON.stringify([item.label, item.observation])}>
          <p className="break-words font-medium">{item.label} · {item.observation}</p>
          <p className="text-muted">{item.observed ? 'Observé' : 'À confirmer'} · {item.tools.join(', ')}</p>
          <p>{item.check}</p>
        </li>)}
      </ol> : <p className="text-muted">Aucune piste prioritaire dans les observations analysées.</p>}
      <p className="text-xs text-muted">Les pistes demandent une validation manuelle avant de devenir des Findings.</p>
      <h4 className="font-medium">Découvertes par outil</h4>
      <ul className="space-y-2">
        {summary.tools.map(tool => <li key={tool.name} className="rounded border border-border px-3 py-2">
          <p className="break-words font-medium">{tool.name}</p>
          <p className="text-muted">{tool.counts.map(([kind, count]) => `${kind} × ${count}`).join(' · ')}</p>
          {tool.examples.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {tool.examples.map(item => <li key={JSON.stringify([item.label, item.observation])} className="break-words">
              {item.observation} <span className="text-muted">· {item.observed ? 'Observé' : 'À confirmer'}{!item.inScope && ' · Périmètre non établi ou exclu'}</span>
            </li>)}
          </ul>}
        </li>)}
      </ul>
    </>}
  </section>;
}
