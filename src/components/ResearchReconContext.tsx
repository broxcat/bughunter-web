'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ReconPanelState } from '@/lib/research/recon';
import type { ResearchProvider } from '@/lib/research/provider';
import { providerName } from '@/lib/research/provider';

const kinds = ['assets', 'endpoints', 'technologies', 'observations', 'sources'] as const;
type DetailKind = typeof kinds[number];
type Detail = { snapshotId: string; kind: DetailKind; page: number; total: number; items: unknown[];unavailable?:boolean };
export default function ResearchReconContext({ targetId, provider, connected }: { targetId: string; provider: ResearchProvider; connected: boolean }) {
  const [state, setState] = useState<ReconPanelState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [details, setDetails] = useState<Detail | null>(null);
  const endpoint = `/api/research-targets/${targetId}/recon`;
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: 'no-store' }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Context unavailable');
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
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Action unavailable');
      if (action === 'generate') { setState(body); setDetails(null); setMessage('Snapshot available. The conversation remains linked to previously delivered versions.'); }
      else {
        setMessage(body.status === 'STAGED' ? `Message staged in ${providerName(provider)}. Review the text, then press Enter in the console to send it.` : body.status === 'UNKNOWN' ? 'Delivery acknowledgement unavailable. Check the console before retransmitting.' : 'Delivery refused. Check that the selected session is open.');
        await load();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Action unavailable'); }
    finally { setBusy(false); }
  };
  const detail = async (kind: DetailKind, page = 0) => {
    if (!state?.snapshot) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${endpoint}?snapshotId=${state.snapshot.id}&kind=${kind}&page=${page}`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Details unavailable'); setDetails(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'Details unavailable'); }
    finally { setBusy(false); }
  };
  const snapshot = state?.snapshot, context = snapshot?.context;
  return <details className="shrink-0 border-b border-slate-800 px-3 py-2 text-xs">
    <summary className="cursor-pointer font-medium">Recon context{context ? ` · ${context.counts.assets} assets · ${context.counts.endpoints} endpoints` : ' · generate a snapshot of available results'}{state?.updateAvailable ? ' · update available' : ''}</summary>
    <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-2">
      {snapshot && context && <>
        <p>Last generated: <time dateTime={snapshot.createdAt}>{snapshot.createdAt}</time> · version {context.schemaVersion} · snapshot <code>{snapshot.contentSha256.slice(0, 12)}</code> · scope <code>{context.scopeId}</code></p>
        <p>{context.counts.assets} assets · {context.counts.endpoints} endpoints · {context.counts.technologies} technology signatures · {context.counts.observations} observations · {context.counts.sources} sources</p>
        {!!context.scopeAssets?.length && <p>Scope assets: {context.scopeAssets.map(a => `${a.normalizedValue} · ${a.type.replaceAll('_', ' ')} · ${a.assetValue}`).join(' ; ')}. Type and value express classification and priority.</p>}
        {context.technologies.length > 0 && <p>Technologies: {context.technologies.map(t => t.name).join(', ')}. Versions unconfirmed.</p>}
        {(state.updateAvailable || state.aged) && <p role="status" className="text-amber-300">{state.updateAvailable ? 'Recon results or policy changed. Regenerate explicitly to prepare a new version.' : 'This snapshot is more than seven days old. Check observation dates before investigation.'} Previously delivered versions are retained.</p>}
        <details><summary className="cursor-pointer">Warnings ({context.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{context.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>
        <details><summary className="cursor-pointer">Investigation suggestions ({context.counts.suggestions})</summary>
          <ul className="mt-2 space-y-3">{context.suggestions.map(s => <li key={s.id} className="rounded border border-slate-800 p-2">
            <p className="break-all font-medium">{s.asset}</p><p>{s.reason}</p>
            <p>Confidence: {s.confidence} · Freshness at generation: {s.freshness} · {s.mode === 'PASSIVE_REVIEW' ? 'Passive review only' : 'Review within current scope'} · scope {s.scopeId}</p>
            <p className="break-all">Observations: {s.observationIds.join(', ')} · Sources: {s.sources.join(', ')}</p>
          </li>)}</ul>
          {!context.suggestions.length && <p>No prioritized lead is available from the current data. This does not demonstrate the absence of vulnerabilities.</p>}
        </details>
        <div className="flex flex-wrap gap-2">{kinds.map(kind => <button className="rounded border border-slate-700 px-2 py-1" disabled={busy} key={kind} onClick={() => void detail(kind)}>View {kind}</button>)}</div>
        {details && <div className="space-y-2">{details.unavailable?<p role="status">This historical snapshot does not record this collection; coverage is unknown.</p>:<p>{details.kind} · {details.total} entries · page {details.page + 1}</p>}<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2">{JSON.stringify(details.items, null, 2)}</pre>
          <div className="flex gap-2"><button disabled={busy || details.page === 0} onClick={() => void detail(details.kind, details.page - 1)}>← Previous</button><button disabled={busy || (details.page + 1) * 25 >= details.total} onClick={() => void detail(details.kind, details.page + 1)}>Next →</button><button onClick={() => setDetails(null)}>Close</button></div>
        </div>}
      </>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="rounded border border-slate-700 px-2 py-1" onClick={() => void act('generate')}>{snapshot ? 'Regenerate context' : 'Generate context'}</button>
        {snapshot && <button disabled={busy || !connected} className="rounded border border-slate-700 px-2 py-1" onClick={() => void act('transmit')}>Send to {providerName(provider)}</button>}
      </div>
      <p>Files are shared by both engines. Send when the selected console is ready and its input is empty; the message is staged without automatic submission. No permission or MCP rule changes.</p>
      {state && state.deliveries.length > 0 && <details><summary className="cursor-pointer">Delivered versions by session (up to 20 most recent)</summary><ul className="mt-2 space-y-1">{state.deliveries.map(d => <li key={d.id}>{d.createdAt} · {providerName(d.provider)} · snapshot <code>{d.snapshotId}</code> · {d.status}</li>)}</ul><p>STAGED means a message was loaded into the console; it does not prove the model read it.</p></details>}
      {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-300">{error}</p>}
    </div>
  </details>;
}
