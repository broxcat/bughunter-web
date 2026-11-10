'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/Button';

export default function AutomationDecisionButton({ programId, phrase, version }: { programId: string; phrase: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function dismiss() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/programs/' + programId + '/automation-decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phrase, expectedPolicyVersion: version }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'The decision could not be saved. Please retry.');
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The decision could not be saved. Please retry.'); }
    finally { setBusy(false); }
  }
  return <span className="inline-flex flex-wrap items-center gap-2">
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void dismiss()}>{busy ? 'Saving…' : 'Not a testing ban'}</Button>
    {error && <span role="alert" className="text-sm text-danger">{error}</span>}
  </span>;
}
