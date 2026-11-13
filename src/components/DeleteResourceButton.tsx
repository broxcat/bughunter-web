'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';

export default function DeleteResourceButton({ url, name, redirectTo }: { url: string; name: string; redirectTo?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Deletion incomplete; retry');
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Button variant="danger" size="sm" onClick={() => setOpen(true)}>Delete target</Button>
    {open && <Dialog title="Delete target?" onClose={() => { if (!busy) setOpen(false); }}>
      <p className="break-all">{name}</p>
      <p className="my-4 text-sm">This permanently deletes this target, its scope assets, recon evidence, findings and research summaries. Active scans will be stopped.</p>
      {error && <p className="my-3 text-danger" role="alert">{error}</p>}
      <Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Confirm deletion'}</Button>
    </Dialog>}
  </>;
}
