# Default AI provider and Recon reports

Settings holds one saved configuration per provider and one default AI provider per user. Saving a configuration and selecting the default are separate actions. Use **Set as default** on a saved provider to select it; model, endpoint and credentials remain the values saved in Settings.

The shared server resolver supplies the default to AI assistance and new Recon reports. No default is inferred from provider order and there is no fallback to another provider. Missing or invalid configuration produces a useful Settings message. Codex and Claude Research consoles retain their existing provider selection; an AI report provider does not become a Research console.

## Captured report routing

Scheduling a report captures its provider, model, effective endpoint, prompt version and evidence fingerprint. Execution uses that captured provider and its current backend credentials. Changing the default affects subsequent reports; it neither rewrites nor redirects pending or historical reports. Changing a model or endpoint likewise requires a new report to use the new selection. Existing summaries remain readable and display their captured provider/model/prompt. A separate notice explains when the current default differs.

Historical summaries receive `OLLAMA` through the additive provider-column migration. Their original prompt versions, content and provenance are preserved.

Recon facts remain deterministic application data. AI providers write a separately validated narrative. Provider unavailability, invalid credentials or unusable output leave the facts readable with a human explanation; they do not change Recon status or start scanners. A default-provider change is distinct from stale Recon, changed scope or a newer report format.

## Credentials and structured output

API keys remain encrypted in `AiProviderConfig`. The server decrypts only the selected provider's key for inference. Keys and ciphertext are excluded from public report DTOs, report inputs, fingerprints, prompts, browser state and logs. OpenRouter receives the selected model and a strict JSON Schema through `response_format`, with `provider.require_parameters` enabled. Unsupported models or provider errors never silently route to Ollama or another model.

## Optional real acceptance

`tests/recon/runReportV3Real.mjs --routing` uses a private Recon export and encrypted Settings fixture, creates a disposable PostgreSQL/Redis stack, and tests Ollama → OpenRouter → Ollama without changing production Settings. It validates captured provider/model, bounded calls, canonical citations, unchanged factual evidence and authenticated UI metadata/default switching. Paid requests require explicit authorization and are limited to the existing two-attempt report policy.

The fixture contains ciphertext only. The harness obtains the existing encryption master in memory and supplies it as a backend environment variable, never as a CLI argument value or disk file. Only selected configured provider origins and the isolated browser origin are allowed. Output contains bounded acceptance metadata, never prompts, keys or model response bodies. Disposable containers and temporary copies are removed afterward.

`--openrouter-only` reuses previously validated real Ollama reports as historical fixtures and sends only the selected OpenRouter report. `--allow-factual-only` explicitly accepts a successful factual fallback while recording `realNarrativeValidated: false`; it never turns an upstream failure into a successful model validation. `--browser-only` replays those persisted reports without inference calls. Catalog support and valid credentials do not guarantee that every upstream model route will accept a request; report the actual HTTP outcome and retain the factual report.

## Provider capabilities and upgrade

Ollama alone uses `/api/show` inspection. API providers use a conservative 8,192-token application envelope when metadata is unavailable; no Ollama model capability is borrowed. OpenRouter and OpenAI receive native JSON Schema when requested. Other providers keep prompted JSON plus the same application validation unless their registry policy explicitly supports more. No model alias/remap is applied to captured Recon jobs.

Migration `20261104100000_default_ai_provider` adds `ReconSummary.provider` with an `OLLAMA` backfill and a partial unique index enforcing at most one `isActive` configuration per user. Only invalid historical duplicate defaults are repaired, retaining the most recently edited row (ID breaks ties). No second default-provider column is introduced.

Rebuild `web` and `worker`, run `prisma migrate deploy`, then recreate those two services. Research-console and Burp require no changes.
