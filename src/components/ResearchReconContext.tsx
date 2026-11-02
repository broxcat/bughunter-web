'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ReconPanelState } from '@/lib/research/recon';
import type { ResearchProvider } from '@/lib/research/provider';
import { providerName } from '@/lib/research/provider';

const kinds = ['assets', 'endpoints', 'technologies', 'observations', 'sources'] as const;
type DetailKind = typeof kinds[number];
type Detail = { snapshotId: string; kind: DetailKind; page: number; total: number; items: unknown[] };
export default function ResearchReconContext({ targetId, provider, connected }: { targetId: string; provider: ResearchProvider; connected: boolean }) {
  const [state, setState] = useState<ReconPanelState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [details, setDetails] = useState<Detail | null>(null);
  const endpoint = `/api/research-targets/${targetId}/recon`;
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: 'no-store' }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Contexte indisponible');
    setState(body);
  }, [endpoint]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => { if (!disposed) void load().catch(e => { if (!disposed) setError(e.message); }); };
    refresh(); const timer = setInterval(refresh, 30000);
    return () => { disposed = true; clearInterval(timer); };
  }, [load, connected]);
  const act = async (action: 'generate' | 'transmit') => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'generate' ? { action } : { action, snapshotId: state!.snapshot!.id, provider }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Action indisponible');
      if (action === 'generate') { setState(body); setDetails(null); setMessage('Snapshot disponible. La conversation reste liée aux versions déjà transmises.'); }
      else {
        setMessage(body.status === 'STAGED' ? `Message chargé dans ${providerName(provider)}. Vérifiez le texte puis validez avec Entrée dans la console.` : body.status === 'UNKNOWN' ? 'Accusé de réception indisponible. Vérifiez la console avant de retransmettre.' : 'Transmission refusée. Vérifiez que la session choisie est ouverte.');
        await load();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Action indisponible'); }
    finally { setBusy(false); }
  };
  const detail = async (kind: DetailKind, page = 0) => {
    if (!state?.snapshot) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${endpoint}?snapshotId=${state.snapshot.id}&kind=${kind}&page=${page}`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Détails indisponibles'); setDetails(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'Détails indisponibles'); }
    finally { setBusy(false); }
  };
  const snapshot = state?.snapshot, context = snapshot?.context;
  return <details className="shrink-0 border-b border-slate-800 px-3 py-2 text-xs">
    <summary className="cursor-pointer font-medium">Contexte Recon{context ? ` · ${context.counts.assets} assets · ${context.counts.endpoints} endpoints` : ' · générer un snapshot des résultats disponibles'}{state?.updateAvailable ? ' · Mise à jour disponible' : ''}</summary>
    <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-2">
      {snapshot && context && <>
        <p>Dernière génération : <time dateTime={snapshot.createdAt}>{snapshot.createdAt}</time> · version {context.schemaVersion} · snapshot <code>{snapshot.contentSha256.slice(0, 12)}</code> · scope <code>{context.scopeId}</code></p>
        <p>{context.counts.assets} assets · {context.counts.endpoints} endpoints · {context.counts.technologies} signatures techniques · {context.counts.observations} observations · {context.counts.sources} sources</p>
        {!!context.scopeAssets?.length && <p>Scope assets : {context.scopeAssets.map(a => `${a.normalizedValue} · ${a.type.replaceAll('_', ' ')} · ${a.assetValue}`).join(' ; ')}. Type et valeur expriment une classification et une priorité.</p>}
        {context.technologies.length > 0 && <p>Technologies : {context.technologies.map(t => t.name).join(', ')}. Versions non confirmées.</p>}
        {(state.updateAvailable || state.aged) && <p role="status" className="text-amber-300">{state.updateAvailable ? 'Les résultats Recon ou la politique ont changé. Régénérez explicitement pour préparer une nouvelle version.' : 'Ce snapshot a plus de sept jours. Vérifiez les dates des observations avant toute investigation.'} Les versions déjà transmises restent conservées.</p>}
        <details><summary className="cursor-pointer">Avertissements ({context.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{context.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>
        <details><summary className="cursor-pointer">Suggestions d’investigation ({context.counts.suggestions})</summary>
          <ul className="mt-2 space-y-3">{context.suggestions.map(s => <li key={s.id} className="rounded border border-slate-800 p-2">
            <p className="break-all font-medium">{s.asset}</p><p>{s.reason}</p>
            <p>Confiance : {s.confidence} · Fraîcheur à la génération : {s.freshness} · {s.mode === 'PASSIVE_REVIEW' ? 'Revue passive uniquement' : 'Revue sous le scope courant'} · scope {s.scopeId}</p>
            <p className="break-all">Observations : {s.observationIds.join(', ')} · Sources : {s.sources.join(', ')}</p>
          </li>)}</ul>
          {!context.suggestions.length && <p>Aucune piste priorisée sur les données disponibles. Cela ne démontre pas l’absence de vulnérabilité.</p>}
        </details>
        <div className="flex flex-wrap gap-2">{kinds.map(kind => <button className="rounded border border-slate-700 px-2 py-1" disabled={busy} key={kind} onClick={() => void detail(kind)}>Voir {kind}</button>)}</div>
        {details && <div className="space-y-2"><p>{details.kind} · {details.total} entrées · page {details.page + 1}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2">{JSON.stringify(details.items, null, 2)}</pre>
          <div className="flex gap-2"><button disabled={busy || details.page === 0} onClick={() => void detail(details.kind, details.page - 1)}>← Précédent</button><button disabled={busy || (details.page + 1) * 25 >= details.total} onClick={() => void detail(details.kind, details.page + 1)}>Suivant →</button><button onClick={() => setDetails(null)}>Fermer</button></div>
        </div>}
      </>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="rounded border border-slate-700 px-2 py-1" onClick={() => void act('generate')}>{snapshot ? 'Régénérer le contexte' : 'Générer le contexte'}</button>
        {snapshot && <button disabled={busy || !connected} className="rounded border border-slate-700 px-2 py-1" onClick={() => void act('transmit')}>Transmettre à {providerName(provider)}</button>}
      </div>
      <p>Les fichiers sont partagés par les deux moteurs. Transmettez lorsque la console choisie est prête et son champ de saisie vide ; le message sera chargé sans envoi automatique. Aucune permission ni règle MCP ne change.</p>
      {state && state.deliveries.length > 0 && <details><summary className="cursor-pointer">Versions transmises par session</summary><ul className="mt-2 space-y-1">{state.deliveries.map(d => <li key={d.id}>{d.createdAt} · {providerName(d.provider)} · snapshot <code>{d.snapshotId}</code> · {d.status}</li>)}</ul><p>STAGED indique un message chargé dans la console, sans attester de sa lecture par le modèle.</p></details>}
      {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-300">{error}</p>}
    </div>
  </details>;
}
