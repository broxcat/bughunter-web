"use client";

import { useEffect, useState, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PROVIDERS as SPECS } from "@/server/brain/providers";

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
  const [baseUrl, setBaseUrl] = useState(SPECS.ANTHROPIC.defaultBaseUrl ?? "");
  const formRef = useRef<HTMLDetailsElement>(null);
  const [testing, setTesting] = useState(false);
  const [selectingDefault, setSelectingDefault] = useState<Provider | null>(
    null,
  );

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
    fetch("/api/ai-providers", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const saved = (await res.json()).providers ?? [];
        setConfigs(saved);
        const selected = saved.find(
          (config: ProviderConfig) => config.provider === "ANTHROPIC",
        );
        if (selected) {
          setModel(selected.model ?? "");
          setBaseUrl(selected.baseUrl ?? SPECS.ANTHROPIC.defaultBaseUrl ?? "");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        provider,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
      };
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
    const saved = configs.find((config) => config.provider === next);
    setProvider(next);
    setApiKey("");
    setModel(saved?.model ?? SPECS[next].defaultModel ?? "");
    setBaseUrl(
      saved?.baseUrl ??
        SPECS[next].defaultBaseUrl ??
        (next === "OLLAMA"
          ? "http://localhost:11434"
          : "http://localhost:4000/v1"),
    );
    if (formRef.current) formRef.current.open = true;
  }
  async function setDefault(next: Provider) {
    setSelectingDefault(next);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/ai-providers/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error ?? "The default provider could not be changed.",
        );
      }
      await load();
      setNotice(`${next} is the default AI provider.`);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The default provider could not be changed.",
      );
    } finally {
      setSelectingDefault(null);
    }
  }

  async function test(input: {
    provider: Provider;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  }) {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/ai-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Connection test failed");
      setNotice(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  }
  async function remove(provider: Provider) {
    if (!window.confirm(`Supprimer la configuration ${provider} ?`)) return;
    const r = await fetch("/api/ai-providers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    if (!r.ok) {
      setError("Provider could not be deleted");
      return;
    }
    await load();
    setNotice(`${provider} deleted.`);
  }
  return (
    <div className="space-y-6">
      <h1>Settings</h1>
      <h2 className="text-lg font-semibold">AI providers</h2>
      <p className="mt-1 text-sm text-muted">
        Configure providers for optional AI assistance.
      </p>
      {error && (
        <p role="alert" className="text-sm text-brand">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          <Badge tone="proven">{notice}</Badge>
        </p>
      )}

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
          <div className="mt-3 divide-y divide-border border-y border-border">
            {configs.map((c) => (
              <div
                key={c.id}
                role="group"
                aria-label={`Configured ${c.provider} provider`}
                className="flex flex-wrap items-start justify-between gap-4 px-4 py-3"
              >
                <div>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{c.provider}</span>
                    {c.isActive && (
                      <Badge tone="proven" mono>
                        Default
                      </Badge>
                    )}
                  </span>
                  <div className="mt-2 break-all text-xs text-muted">
                    <p>
                      {c.model ? `model: ${c.model}` : "no model set"}
                      {` · ${c.baseUrl ?? SPECS[c.provider].defaultBaseUrl ?? (c.provider === "OLLAMA" ? "http://localhost:11434" : "Endpoint required")}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {KEYLESS.has(c.provider) ? (
                    <Badge tone="neutral">keyless (local)</Badge>
                  ) : c.hasApiKey ? (
                    <Badge tone="proven">key configured</Badge>
                  ) : (
                    <Badge tone="medium">no key</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={testing}
                    onClick={() => void test({ provider: c.provider })}
                  >
                    Test connection
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => selectProvider(c.provider)}
                  >
                    Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void remove(c.provider)}
                  >
                    Supprimer
                  </Button>
                  {!c.isActive && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="ml-3"
                      aria-label={`Set ${c.provider} as default`}
                      disabled={saving || selectingDefault !== null}
                      onClick={() => void setDefault(c.provider)}
                    >
                      {selectingDefault === c.provider
                        ? "Selecting…"
                        : "Set as default"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add / update form */}
      <Button
        onClick={() => {
          setApiKey("");
          if (formRef.current) formRef.current.open = true;
        }}
      >
        Add provider
      </Button>
      <details ref={formRef} className="ui-disclosure max-w-2xl">
        <summary>Provider configuration</summary>
        <div className="mt-5">
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
                Base URL{" "}
                <span className="text-subtle">
                  (
                  {keyless || provider === "LITELLM"
                    ? "required for default"
                    : "optional override"}
                  )
                </span>
              </label>
              <input
                id="baseUrl"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  keyless
                    ? "Your configured Ollama endpoint"
                    : "Leave blank to use the provider URL"
                }
                className={FIELD_CLASS}
              />
            </div>

            <Button
              type="button"
              variant="secondary"
              disabled={testing}
              onClick={() => void test({ provider, model, baseUrl, apiKey })}
            >
              Test connection
            </Button>
            <Button
              type="submit"
              disabled={saving || selectingDefault !== null}
            >
              {saving ? "Saving…" : "Save provider"}
            </Button>
            <p className="text-xs text-muted">
              Save the configuration, then choose Set as default above. Saving
              alone keeps the current default.
            </p>
          </form>
        </div>
      </details>
    </div>
  );
}
