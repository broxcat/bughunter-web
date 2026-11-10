'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ProgramData } from '@/lib/targetFormData';
import DeleteResourceButton from './DeleteResourceButton';
import TargetPolicySettings from './TargetPolicySettings';

export default function TargetSettings({ id }: { id: string }) {
  const [program, setProgram] = useState<ProgramData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/programs/' + id, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Target not found');
        setProgram(await response.json());
        setError('');
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [id]);

  const current = program?.id === id ? program : null;
  return <div className="space-y-5">
    <Link className="text-brand" href={'/targets/' + id}>← Target</Link>
    <h1 className="text-2xl font-semibold">Target settings</h1>
    {error && <p role="alert">{error}</p>}
    {!current && !error && <p role="status">Loading target settings…</p>}
    {current && <>
      <TargetPolicySettings key={current.id} program={current} />
      <details id="delete-target" className="ui-disclosure scroll-mt-24"><summary>Delete target</summary>
        <div className="mt-4"><DeleteResourceButton kind="Target" name={current.companyName}
          url={'/api/programs/' + id} redirectTo="/targets?deleted=1" /></div>
      </details>
    </>}
  </div>;
}
