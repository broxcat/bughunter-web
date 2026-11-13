'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { HYPOTHESIS_STATUSES, REGISTRY_NOTICE, type HypothesisStatus } from '@/lib/research/hypotheses';
import ResearchProof from './ResearchProof';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

type Hypothesis = {
  id: string; externalId: string; title: string; status: HypothesisStatus; hypothesis: string;
  evidenceFor: unknown[]; evidenceAgainst: unknown[]; nextTest: string; expectedSignal: string;
  falsificationCondition: string; blockedReason: string | null; notes: string | null;
  researchData: unknown; promotion: { findingId: string } | null;
};
export type HypothesisListData = {
  session: { status: string }; counts: Record<string, number>; total: number; page: number; pageSize: number; hypotheses: Hypothesis[];
};

export default function ResearchHypotheses({ sessionId, initial, initialStatus }: {
  sessionId: string; initial: HypothesisListData; initialStatus?: HypothesisStatus;
}) {
  const [data, setData] = useState(initial);
  const status = initialStatus ?? '';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function navigate(next: HypothesisStatus | '', page = 1, replace = false) {
    const query = new URLSearchParams();
    if (next) query.set('status', next);
    query.set('hypothesisPage', String(page));
    const href = '/research/history/' + sessionId + '?' + query;
    if (replace) router.replace(href); else router.push(href);
  }
  async function filter(next: HypothesisStatus | '', page = 1) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/research-sessions/' + sessionId + '/hypotheses?' + new URLSearchParams({
        ...(next ? { status: next } : {}), page: String(page),
      }), { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load hypotheses');
      const body = await response.json();
      setData(body);
      navigate(next, body.page, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load hypotheses');
    } finally {
      setBusy(false);
    }
  }

  return <section id="hypotheses" className="space-y-4" aria-label="Hypotheses">
    <h2 className="text-xl">Hypotheses</h2>
    <p>Read-only Research registry. A CONFIRMED hypothesis is a research claim requiring human evidence review before any Finding.</p>
    {error && <p role="alert">{error}</p>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{HYPOTHESIS_STATUSES.map(value =>
      <Card key={value} className="p-3"><p>{value}</p><p aria-label={value + ' hypotheses'} className="text-2xl">{data.counts[value] ?? 0}</p></Card>)}</div>
    <div className="flex flex-wrap gap-2" aria-label="Filter hypotheses">{(['', ...HYPOTHESIS_STATUSES] as const).map(value =>
      <Button key={value} variant="secondary" disabled={busy} aria-pressed={status === value} onClick={() => void filter(value)}>
        {value ? value[0] + value.slice(1).toLowerCase() : 'All'}
      </Button>)}</div>
    {data.hypotheses.map(hypothesis => <Card key={hypothesis.id} className="space-y-2 p-5">
      <p>{hypothesis.externalId} · {hypothesis.status}</p><h3 className="text-lg font-semibold">{hypothesis.title}</h3>
      {hypothesis.status === 'CONFIRMED' && <p className="font-semibold">{REGISTRY_NOTICE}</p>}
      <p><strong>Hypothesis:</strong> {hypothesis.hypothesis}</p>
      <p>Evidence for: {hypothesis.evidenceFor.length} · Evidence against: {hypothesis.evidenceAgainst.length}</p>
      {hypothesis.status === 'BLOCKED' && <p>Blocked: {hypothesis.blockedReason}</p>}
      {hypothesis.status === 'REJECTED' && hypothesis.notes && <p>Why rejected: {hypothesis.notes}</p>}
      <ResearchProof value={hypothesis.researchData} compact />
      {hypothesis.promotion && <p>Finding draft already created; Evidence Review remains independent.</p>}
      <p><strong>Next distinct test:</strong> {hypothesis.nextTest}</p>
      <p><strong>Expected signal:</strong> {hypothesis.expectedSignal}</p>
      <p><strong>Falsification condition:</strong> {hypothesis.falsificationCondition}</p>
      <Link href={'/research/history/' + sessionId + '/hypotheses/' + hypothesis.id} className="text-brand">View details — {hypothesis.externalId}</Link>
    </Card>)}
    {!data.hypotheses.length && <p>No hypotheses in this view.</p>}
    {data.total > data.pageSize && <div className="flex gap-3">
      <Button disabled={busy || data.page === 1} onClick={() => void filter(status, data.page - 1)}>Previous</Button>
      <p>Page {data.page} / {Math.ceil(data.total / data.pageSize)}</p>
      <Button disabled={busy || data.page * data.pageSize >= data.total} onClick={() => void filter(status, data.page + 1)}>Next</Button>
    </div>}
  </section>;
}
