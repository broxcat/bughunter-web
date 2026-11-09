
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { TOKEN_PLATFORMS } from '@/lib/platformConnections';
import { platformLabel } from '@/lib/platformPresentation';
import { Button } from '@/components/ui/Button';

const field = 'mt-1 block w-full rounded border border-border bg-surface px-3 py-2';
const hints = {
  HACKERONE: 'Use your HackerOne username and personal Hacker API token.',
  BUGCROWD: 'Use a verified researcher account with Hacker API access. Grant only read:engagement_list.',
  INTIGRITI: 'Use a personal access token from your Intigriti researcher settings.',
};

export default function PlatformConnections() {
  const [connections, setConnections] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/settings/platform-connections', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not load platform connections.');
        const result = await response.json();
        setConnections(result.connections.map((row: { platform: string }) => row.platform));
      })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load platform connections.'); });
    return () => controller.abort();
  }, []);

  async function update(platform: string, method: 'PUT' | 'DELETE', form?: HTMLFormElement) {
    setBusy(platform);
    setMessage('');
    setError('');
    try {
      const values = form ? Object.fromEntries(new FormData(form)) : {};
      const response = await fetch('/api/settings/platform-connections', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, ...values }),
      });
      if (!response.ok) throw new Error('Could not update this platform connection.');
      setConnections(current => method === 'PUT' ? [...new Set([...(current ?? []), platform])] : (current ?? []).filter(value => value !== platform));
      setMessage(platformLabel(platform) + (method === 'PUT' ? ' connection saved.' : ' connection removed.'));
    } catch {
      setError('Could not update this platform connection.');
    } finally {
      form?.reset();
      setBusy(null);
    }
  }

  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">Platform connections</h2>
    <p className="text-sm text-muted">Connections are used for read-only previews of public programs.</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {connections && TOKEN_PLATFORMS.map(platform => <details className="ui-disclosure max-w-2xl" key={platform}>
      <summary>{platformLabel(platform)} · {connections.includes(platform) ? 'Connected' : 'Not connected'}</summary>
      <p className="my-3 text-sm text-muted">{hints[platform]}</p>
      <form className="space-y-3" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void update(platform, 'PUT', event.currentTarget);
      }}>
        {platform !== 'INTIGRITI' && <label className="block text-sm">
          {platform === 'BUGCROWD' ? 'Token ID' : 'HackerOne username'}
          <input name="username" className={field} required autoComplete="off" maxLength={128} />
        </label>}
        <label className="block text-sm">API token<input name="token" type="password" className={field} required autoComplete="off" maxLength={2048} /></label>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy !== null}>Save connection</Button>
          {connections.includes(platform) && <Button type="button" variant="secondary" disabled={busy !== null}
            onClick={() => void update(platform, 'DELETE')}>Remove connection</Button>}
        </div>
      </form>
    </details>)}
    <p className="text-sm text-muted">YesWeHack · Public previews use anonymous access.</p>
  </section>;
}
