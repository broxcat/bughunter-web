'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CampaignCommand } from '@/lib/targetCampaign';
import { Button } from './ui/Button';

export default function CampaignCommandButton({ programId, command, label, destination, secondary }: {
  programId: string; command: CampaignCommand; label: string; destination?: string; secondary?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  async function act() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/programs/' + programId + '/campaign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: command }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Campaign action unavailable');
      startTransition(() => { if (destination) router.push(destination); router.refresh(); });
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div><Button variant={secondary ? 'secondary' : 'primary'} disabled={busy || pending} onClick={() => void act()}>
    {busy || pending ? 'Saving…' : label}
  </Button>{error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}</div>;
}
