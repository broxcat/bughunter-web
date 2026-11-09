'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from './ui/Button';

type Routing = { fastProvider: string | null; fastModel: string | null; reviewProvider: string | null; reviewModel: string | null };
const inputClass = 'block w-full rounded border border-border bg-surface p-2';

export default function ResearchModelSettings({ providers }: { providers: Array<{ provider: string; model: string | null }> }) {
  const [routing, setRouting] = useState<Routing | null>(null);
  const [embeddingsConfigured, setEmbeddingsConfigured] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/research-routing', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Research routing could not be loaded.');
      const data = await response.json();
      setRouting(data.routing);
      setEmbeddingsConfigured(data.embeddingsConfigured);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!routing || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/research-routing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(routing) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Research routing could not be saved.');
      setRouting(data.routing);
      setEmbeddingsConfigured(data.embeddingsConfigured);
      setMessage('Research routing saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Research routing could not be saved.');
    } finally { setBusy(false); }
  }

  return <section className="max-w-2xl space-y-3">
    <h2 className="text-lg font-medium">Research model routing</h2>
    <p className="text-sm text-muted">Research selects a model from the appropriate profile automatically. Choose a lightweight model for planning and a stronger one for independent review.</p>
    <p className="text-sm">{embeddingsConfigured ? 'Semantic memory service configured.' : 'Configure RESEARCH_EMBEDDING_URL and RESEARCH_EMBEDDING_MODEL on the server to enable semantic memory.'}</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {routing && <form onSubmit={save} className="space-y-3">
      {(['fast', 'review'] as const).map(tier => {
        const providerKey = `${tier}Provider` as const;
        const modelKey = `${tier}Model` as const;
        return <fieldset key={tier} className="space-y-2" disabled={busy}>
          <legend className="font-medium">{tier === 'fast' ? 'Map and prepare a test' : 'Validate and trace impact'}</legend>
          <label className="block">Provider
            <select className={inputClass} value={routing[providerKey] ?? ''} onChange={event => setRouting({ ...routing, [providerKey]: event.target.value || null, [modelKey]: null })}>
              <option value="">Use default AI provider</option>
              {providers.map(item => <option key={item.provider} value={item.provider}>{item.provider}{item.model ? ` · ${item.model}` : ''}</option>)}
            </select>
          </label>
          <label className="block">Model override
            <input className={inputClass} maxLength={200} disabled={!routing[providerKey]} placeholder="Use saved provider model" value={routing[modelKey] ?? ''}
              onChange={event => setRouting({ ...routing, [modelKey]: event.target.value || null })} />
          </label>
        </fieldset>;
      })}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save research routing'}</Button>
    </form>}
  </section>;
}
