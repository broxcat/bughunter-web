
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { headersFromLines, type HunterIdentity } from '@/lib/programExecutionPolicy';
import { Button } from './ui/Button';

const fieldClass = 'mt-1 block w-full rounded border border-border bg-surface p-2';

export default function HunterIdentitySettings() {
  const [identity, setIdentity] = useState<HunterIdentity | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/settings/hunter-identity', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load hunter identity.');
      setIdentity(await response.json());
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { userAgent: String(form.get('userAgent')).trim() || null, headers: headersFromLines(String(form.get('headers'))) };
    setSaving(true); setSaved(false); setError('');
    try {
      const response = await fetch('/api/settings/hunter-identity', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setSaved(true);
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }

  return <section className="max-w-2xl space-y-3">
    <h2 className="text-lg font-semibold">Hunter identity</h2>
    <p className="text-sm text-muted">Program requirements take precedence. Use identification headers that you are willing to send to authorized targets.</p>
    {identity && <form className="space-y-3" onSubmit={submit}>
      <label className="block">Default User-Agent<input name="userAgent" maxLength={512} defaultValue={identity.userAgent ?? ''} className={fieldClass} /></label>
      <label className="block">Default headers<textarea name="headers" rows={2} defaultValue={identity.headers.map(({ name, value }) => name + ': ' + value).join('\n')} placeholder="X-Bug-Bounty: your-username" className={fieldClass} /></label>
      <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save hunter identity'}</Button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Hunter identity saved.</p>}
  </section>;
}
