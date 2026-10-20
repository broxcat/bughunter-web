"use client";

import { useEffect, useState } from "react";

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
  const [isActive, setIsActive] = useState(false);

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
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { provider, isActive };
      // Only send apiKey when the user typed one, so saving without re-entering
      // the key leaves the stored cipher untouched.
      if (!keyless && apiKey.trim()) body.apiKey = apiKey.trim();
      if (model.trim()) body.model = model.trim();
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">AI Provider Settings</h1>
      <p className="mt-1 text-sm text-gray-500">
        Configure the AI provider used for hunting. API keys are encrypted at
        rest and never returned to the browser. Only one provider is active at a
        time.
      </p>

      {/* Configured providers */}
      <section className="mt-8">
        <h2 className="text-lg font-medium">Configured providers</h2>
        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading…</p>
        ) : configs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No providers configured yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-200 rounded-md border border-gray-200">
            {configs.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div>
                  <span className="font-medium">{c.provider}</span>
                  {c.isActive && (
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                      ACTIVE
                    </span>
                  )}
                  <div className="mt-0.5 text-xs text-gray-500">
                    {c.model ? `model: ${c.model}` : "no model set"}
                    {c.baseUrl ? ` · ${c.baseUrl}` : ""}
                  </div>
                </div>
                <div className="text-right text-xs">
                  {KEYLESS.has(c.provider) ? (
                    <span className="text-gray-400">keyless (local)</span>
                  ) : c.hasApiKey ? (
                    <span className="text-green-700">key configured</span>
                  ) : (
                    <span className="text-amber-600">no key</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add / update form */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">Add or update a provider</h2>
        <form onSubmit={onSubmit} className="mt-3 space-y-4">
          <div>
            <label
              htmlFor="provider"
              className="block text-sm font-medium text-gray-700"
            >
              Provider
            </label>
            <select
              id="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                className="block text-sm font-medium text-gray-700"
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
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Stored encrypted. Leave blank when only changing the model or
                base URL.
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="model"
              className="block text-sm font-medium text-gray-700"
            >
              Model
            </label>
            <input
              id="model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. claude-opus-4-8, llama3.1, gpt-4o"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="baseUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Base URL <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="baseUrl"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                keyless ? "http://localhost:11434" : "https://api.provider.com"
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="isActive"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">
              Make this the active provider
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-green-700">{notice}</p>}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save provider"}
          </button>
        </form>
      </section>
    </div>
  );
}
