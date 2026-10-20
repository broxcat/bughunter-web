// BrainClient — fetch-based multi-provider LLM client, ported from the CLI
// brain.py LLMClient. Three request/response shapes: Anthropic Messages API,
// OpenAI-compatible chat/completions, and Ollama. Timeout per request (abort),
// bounded retries on transient failures.
//
// SECURITY: this module is server-only (src/server/). API keys arrive already
// decrypted from the caller (see ./index.ts resolveActiveBrain) and are only
// ever sent to the provider endpoint — never logged, never returned to a client.

import {
  PROVIDERS,
  DEEPSEEK_LEGACY_ALIASES,
  type AiProviderName,
  type ProviderSpec,
} from "./providers";

export interface BrainConfig {
  provider: AiProviderName;
  /** Decrypted API key. Null/undefined for keyless providers (Ollama). */
  apiKey?: string | null;
  /** Per-user model override; falls back to the provider default. */
  model?: string | null;
  /** Per-user base-URL override; falls back to the provider default. */
  baseUrl?: string | null;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Transient-failure retries (network / 5xx / 429). Default 2. */
  retries?: number;
  signal?: AbortSignal;
  /**
   * Ollama only: forwarded as the top-level `think` field of /api/chat. Set
   * false to make a reasoning model answer directly instead of spending the
   * token budget on hidden thinking. Omitted = provider default (unchanged).
   */
  think?: boolean;
}

const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 2;
const MAX_CTX = 8192;
const ANTHROPIC_VERSION = "2023-06-01";

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export class BrainError extends Error {
  constructor(
    message: string,
    readonly provider: AiProviderName,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BrainError";
  }
}

export class BrainClient {
  private readonly spec: ProviderSpec;
  private readonly baseUrl: string | null;

  constructor(private readonly config: BrainConfig) {
    this.spec = PROVIDERS[config.provider];
    if (!this.spec) {
      throw new BrainError(`Unknown provider: ${config.provider}`, config.provider);
    }
    this.baseUrl =
      (config.baseUrl && config.baseUrl.trim()) || this.spec.defaultBaseUrl;
  }

  /** Human-readable provider description (no secrets). */
  get description(): string {
    return `${this.config.provider} (${this.spec.kind})`;
  }

  /**
   * Send a single-turn chat (system + user) and return the assistant reply.
   * Throws BrainError on unrecoverable failure.
   */
  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<string> {
    const retries = opts.retries ?? DEFAULT_RETRIES;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        switch (this.spec.kind) {
          case "anthropic":
            return await this.chatAnthropic(system, user, opts);
          case "openai":
            return await this.chatOpenAiCompat(system, user, opts);
          case "ollama":
            return await this.chatOllama(system, user, opts);
        }
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof BrainError
            ? err.status === undefined || isRetryableStatus(err.status)
            : true; // network/abort-type errors are retryable
        if (!retryable || attempt === retries) break;
        await delay(backoffMs(attempt));
      }
    }
    if (lastErr instanceof BrainError) throw lastErr;
    throw new BrainError(
      `chat failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      this.config.provider,
    );
  }

  private resolveModel(opts: ChatOptions): string {
    const model = opts.model || this.config.model || this.spec.defaultModel;
    if (!model) {
      throw new BrainError(
        `No model configured for ${this.config.provider}`,
        this.config.provider,
      );
    }
    const aliased = this.spec.legacyAliases?.[model];
    return aliased ?? model;
  }

  private async doFetch(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    opts: ChatOptions,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    // Chain the caller's abort signal, if any.
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new BrainError(
          `${this.config.provider} HTTP ${res.status}${detail ? `: ${truncate(detail, 300)}` : ""}`,
          this.config.provider,
          res.status,
        );
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async chatAnthropic(
    system: string,
    user: string,
    opts: ChatOptions,
  ): Promise<string> {
    if (!this.config.apiKey) {
      throw new BrainError("ANTHROPIC requires an API key", this.config.provider);
    }
    const url = `${this.baseUrl}/v1/messages`;
    const body = {
      model: this.resolveModel(opts),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      system,
      messages: [{ role: "user", content: user }],
    };
    const json = (await this.doFetch(
      url,
      {
        "x-api-key": this.config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body,
      opts,
    )) as { content?: Array<{ type?: string; text?: string }> };
    const text = json.content?.find((b) => b.text)?.text ?? "";
    return text.trim();
  }

  private async chatOpenAiCompat(
    system: string,
    user: string,
    opts: ChatOptions,
  ): Promise<string> {
    if (!this.baseUrl) {
      throw new BrainError(
        `${this.config.provider} has no base URL configured`,
        this.config.provider,
      );
    }
    if (!this.config.apiKey) {
      throw new BrainError(
        `${this.config.provider} requires an API key`,
        this.config.provider,
      );
    }
    let model = this.resolveModel(opts);
    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    // DeepSeek V4 defaults thinking ON (bills extra); pin it explicitly off
    // unless the model name is the "reasoner" legacy alias.
    if (this.config.provider === "DEEPSEEK") {
      const alias = DEEPSEEK_LEGACY_ALIASES[model];
      let thinking = false;
      if (alias) {
        model = alias.model;
        thinking = alias.thinking;
      }
      body.model = model;
      body.thinking = { type: thinking ? "enabled" : "disabled" };
    }
    const json = (await this.doFetch(
      `${this.baseUrl}/chat/completions`,
      {
        Authorization: `Bearer ${this.config.apiKey}`,
        ...(this.spec.extraHeaders ?? {}),
      },
      body,
      opts,
    )) as { choices?: Array<{ message?: { content?: string } }> };
    return (json.choices?.[0]?.message?.content ?? "").trim();
  }

  private async chatOllama(
    system: string,
    user: string,
    opts: ChatOptions,
  ): Promise<string> {
    const host =
      this.baseUrl || process.env.OLLAMA_HOST || "http://localhost:11434";
    const model = opts.model || this.config.model || (await this.firstOllamaModel(host));
    if (!model) {
      throw new BrainError(
        "No Ollama model available (set a model in provider settings)",
        this.config.provider,
      );
    }
    const json = (await this.doFetch(
      `${host}/api/chat`,
      {},
      {
        model,
        stream: false,
        // `think` is a top-level /api/chat field (not an `options` key). Only
        // sent when explicitly set, so default behavior is unchanged.
        ...(opts.think !== undefined ? { think: opts.think } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        options: {
          num_predict: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
          num_ctx: MAX_CTX,
        },
      },
      opts,
    )) as { message?: { content?: string } };
    return (json.message?.content ?? "").trim();
  }

  private async firstOllamaModel(host: string): Promise<string | null> {
    try {
      const res = await fetch(`${host}/api/tags`);
      if (!res.ok) return null;
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      return json.models?.[0]?.name ?? null;
    } catch {
      return null;
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function backoffMs(attempt: number): number {
  // 0.5s, 1s, 2s … capped at 8s, with a little jitter.
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
