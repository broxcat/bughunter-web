"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import ResearchModelSettings from "@/components/ResearchModelSettings";

// The 11 AiProvider enum values (kept in sync with prisma/schema.prisma).
// OLLAMA runs locally and is keyless; every other provider needs an API key.
const PROVIDERS = [
  "OLLAMA",
  "GROQ",
  "DEEPSEEK",
  "ANTHROPIC",
  "OPENAI",
  "XAI",
  "OPENROUTER",
  "ORCAROUTER",
  "FLUXION",
  "LITELLM",
  "REQUESTY",
] as const;

type Provider = (typeof PROVIDERS)[number];

const KEYLESS: ReadonlySet<string> = new Set(["OLLAMA"]);

type ProviderConfig = {
  id: string;
  provider: Provider;
  model: string | null;
  baseUrl: string | null;
  isActive: boolean;
  hasApiKey: boolean;
};

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-brand";

export default function SettingsPage() {
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form state.
  const [provider, setProvider] = useState<Provider>("ANTHROPIC");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selectingDefault, setSelectingDefault] = useState<Provider | null>(null);

  const keyless = KEYLESS.has(provider);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-providers", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setConfigs(data.providers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/ai-providers", { cache: "no-store" }).then(async res => {
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const saved = (await res.json()).providers ?? [];
      setConfigs(saved);
      const selected = saved.find((config: ProviderConfig) => config.provider === 'ANTHROPIC');
      if (selected) { setModel(selected.model ?? ''); setBaseUrl(selected.baseUrl ?? ''); }
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { provider, model: model.trim(), baseUrl: baseUrl.trim() };
      // Only send apiKey when the user typed one, so saving without re-entering
      // the key leaves the stored cipher untouched.
      if (!keyless && apiKey.trim()) body.apiKey = apiKey.trim();

      const res = await fetch("/api/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }
      setNotice(`Saved ${provider}.`);
      setApiKey(""); // never keep the plaintext key around in the DOM
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function selectProvider(next: Provider) {
    const saved = configs.find(config => config.provider === next);
    setProvider(next); setApiKey(''); setModel(saved?.model ?? ''); setBaseUrl(saved?.baseUrl ?? '');
  }
  async function setDefault(next: Provider) {
    setSelectingDefault(next); setError(null); setNotice(null);
    try {
      const response = await fetch('/api/ai-providers/default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: next }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? 'The default provider could not be changed.'); }
      await load(); setNotice(`${next} is the default AI provider.`);
    } catch (error) { setError(error instanceof Error ? error.message : 'The default provider could not be changed.'); }
    finally { setSelectingDefault(null); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">AI Provider Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Configure the default AI provider for Recon reports and AI assistance. API keys are encrypted at
        rest and never returned to the browser. Research stages use the profiles below.
      </p>
      {error && <p role="alert" className="text-sm text-brand">{error}</p>}
      {notice && <p role="status" className="text-sm"><Badge tone="proven">{notice}</Badge></p>}

      <ResearchModelSettings providers={configs} />

      {/* Configured providers */}
      <section className="mt-8">
        <h2 className="text-lg font-medium">Configured providers</h2>
        {loading ? (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        ) : configs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No providers configured yet.
          </p>
        ) : (
          <Card className="mt-3 divide-y divide-border">
            {configs.map((c) => (
              <div
                key={c.id}
                role="group"
                aria-label={`Configured ${c.provider} provider`}
                className="flex flex-wrap items-start justify-between gap-4 px-4 py-3"
              >
                <div>
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-medium">{c.provider}</span>
                    {c.isActive && (
                      <Badge tone="proven" mono>
                        DEFAULT
                      </Badge>
                    )}
                  </span>
                  <div className="mt-1 break-all font-mono text-xs text-subtle">
                    {c.model ? `model: ${c.model}` : "no model set"}
                    {c.baseUrl ? ` · ${c.baseUrl}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  {KEYLESS.has(c.provider) ? (
                    <Badge tone="neutral">keyless (local)</Badge>
                  ) : c.hasApiKey ? (
                    <Badge tone="proven">key configured</Badge>
                  ) : (
                    <Badge tone="medium">no key</Badge>
                  )}
                  {!c.isActive && <Button size="sm" variant="secondary" className="ml-3" aria-label={`Set ${c.provider} as default`} disabled={saving || selectingDefault !== null} onClick={() => void setDefault(c.provider)}>{selectingDefault === c.provider ? 'Selecting…' : 'Set as default'}</Button>}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Add / update form */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">Add or update a provider</h2>
        <Card className="mt-3 p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="provider"
                className="block text-sm font-medium text-foreground"
              >
                Provider
              </label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => selectProvider(e.target.value as Provider)}
                className={FIELD_CLASS}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {!keyless && (
              <div>
                <label
                  htmlFor="apiKey"
                  className="block text-sm font-medium text-foreground"
                >
                  API key
                </label>
                <input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Leave blank to keep the existing key"
                  className={FIELD_CLASS}
                />
                <p className="mt-1 text-xs text-subtle">
                  Stored encrypted. Leave blank when only changing the model or
                  base URL.
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="model"
                className="block text-sm font-medium text-foreground"
              >
                Model
              </label>
              <input
                id="model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-opus-4-8, llama3.1, gpt-4o"
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label
                htmlFor="baseUrl"
                className="block text-sm font-medium text-foreground"
              >
                Base URL <span className="text-subtle">({keyless || provider === 'LITELLM' ? 'required for default' : 'optional override'})</span>
              </label>
              <input
                id="baseUrl"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  keyless ? "Your configured Ollama endpoint" : "Leave blank to use the provider URL"
                }
                className={FIELD_CLASS}
              />
            </div>

            <Button type="submit" disabled={saving || selectingDefault !== null}>
              {saving ? "Saving…" : "Save provider"}
            </Button>
            <p className="text-xs text-muted">Save the configuration, then choose Set as default above. Saving alone keeps the current default.</p>
          </form>
        </Card>
      </section>
    </div>
  );
}
