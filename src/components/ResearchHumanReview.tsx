'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { REVIEW_VERDICTS, type SavedResearchReview } from '@/lib/research/humanReview';
import { Button } from './ui/Button';

const labels = {
  SUPPORTED: 'Supported',
  REFUTED: 'Refuted',
  INCONCLUSIVE: 'Inconclusive',
};

export function ResearchReviewResult({ review }: { review: SavedResearchReview }) {
  return <div className="space-y-1">
    <p><strong>{labels[review.verdict]}</strong> · <time dateTime={review.reviewedAt}>{review.reviewedAt.slice(0, 10)}</time></p>
    {review.verdict === 'SUPPORTED' && <p>Test {review.testId} · {review.accessContext} · Reproduction, impact and minimum privileges checked.</p>}
    <p className="whitespace-pre-wrap break-words">{review.reason}</p>
  </div>;
}

export default function ResearchHumanReview({ sessionId, hypothesisId, revision, review, canReview, testIds }: {
  sessionId: string;
  hypothesisId: string;
  revision: number;
  review: SavedResearchReview | null;
  canReview: boolean;
  testIds: string[];
}) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<(typeof REVIEW_VERDICTS)[number]>('INCONCLUSIVE');
  const [saved, setSaved] = useState<SavedResearchReview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const fields = new FormData(event.currentTarget);
    const proof = verdict === 'SUPPORTED' ? {
      testId: fields.get('testId'),
      accessContext: fields.get('accessContext'),
      reproducedInFreshContext: fields.has('reproducedInFreshContext'),
      impactDemonstrated: fields.has('impactDemonstrated'),
      minimumPrivilegesVerified: fields.has('minimumPrivilegesVerified'),
    } : {};
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/research-sessions/${sessionId}/hypotheses/${hypothesisId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: revision, verdict, reason: fields.get('reason'), ...proof }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Review could not be saved.');
      setSaved(data);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review could not be saved.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const current = review ?? saved;
  return <section aria-label="Independent evidence decision" className="space-y-3">
    <h2 className="text-xl">Independent evidence decision</h2>
    {current ? <ResearchReviewResult review={current} /> : canReview ? <form className="space-y-3" onSubmit={submit}>
      <p>Record your verdict for this exact revision after checking the workspace evidence. A supported decision is required for a Finding draft.</p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">Verdict <select value={verdict} onChange={event => setVerdict(event.target.value as typeof verdict)} className="rounded border border-border bg-surface p-2">
          {REVIEW_VERDICTS.map(option => <option key={option} value={option} disabled={option === 'SUPPORTED' && testIds.length === 0}>{labels[option]}</option>)}
        </select></label>
        {verdict === 'SUPPORTED' && <>
          <label className="block">Test with direct proof and controls <select name="testId" required defaultValue="" className="rounded border border-border bg-surface p-2">
            <option value="" disabled>Select a test</option>
            {testIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select></label>
          <label className="block">Minimum access context <input name="accessContext" required minLength={3} maxLength={120} placeholder="Anonymous or authorized role" className="rounded border border-border bg-surface p-2" /></label>
          <label className="block"><input type="checkbox" name="reproducedInFreshContext" required /> I reproduced the result in a fresh context.</label>
          <label className="block"><input type="checkbox" name="impactDemonstrated" required /> I traced the observed security impact and checked the control.</label>
          <label className="block"><input type="checkbox" name="minimumPrivilegesVerified" required /> I verified the least privileges needed to reproduce it.</label>
        </>}
        <label className="block">Rationale and evidence references
          <textarea name="reason" required minLength={20} maxLength={1200} rows={3} className="block w-full rounded border border-border bg-surface p-2" />
        </label>
        <Button type="submit">{busy ? 'Recording…' : 'Record decision'}</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form> : <p>Review requires a ready console with current authorization and a synced v2 hypothesis.</p>}
  </section>;
}
