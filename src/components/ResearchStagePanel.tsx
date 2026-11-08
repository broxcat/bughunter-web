'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { HarnessRunView, ResearchStage } from '@/lib/research/workflow';
import { Button } from './ui/Button';

export default function ResearchStagePanel({ title, targetId, input }: {
  title: string;
  targetId: string;
  input: ResearchStage;
}) {
  const [run, setRun] = useState<HarnessRunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function request(execute: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const url = `/api/research-targets/${targetId}/harness`;
      const query = new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]));
      const response = execute
        ? await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, requestKey: crypto.randomUUID() }) })
        : await fetch(`${url}?${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The Research stage is unavailable.');
      setRun(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Research stage is unavailable.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <details className="space-y-2 rounded border border-border p-3">
    <summary className="cursor-pointer font-medium">{title}</summary>
    <p className="text-sm text-muted">Run sends scoped, redacted research summaries to the embedding service and the model selected in <Link className="text-brand" href="/settings">AI Settings</Link>. Results are advisory. Review them before any target interaction or decision.</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy} onClick={() => void request(true)}>Run stage</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void request(false)}>Load last result</Button>
    </div>
    {busy && <p role="status">Working…</p>}
    {error && <p role="alert">{error}</p>}
    {run && <p className="text-sm">{run.provider} · {run.model} · {run.status}</p>}
    {run?.result && <section aria-label="Research stage result" className="space-y-2">
      <h3 className="font-semibold">{run.result.assessment}</h3>
      <p className="whitespace-pre-wrap break-words">{run.result.summary}</p>
      <p className="whitespace-pre-wrap break-words"><strong>Next step </strong>{run.result.nextStep}</p>
      <p className="text-sm">Retrieved memory items: {run.result.memoryUsed}</p>
      <ul className="list-inside list-disc break-words text-sm">
        {run.result.citations.map(citation => <li key={citation.id}>{citation.id} · {citation.label} · {citation.reference}</li>)}
      </ul>
    </section>}
  </details>;
}
