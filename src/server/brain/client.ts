import { currentScanControl, throwIfScanAborted } from "@/server/scanControl";
import { guardedProviderFetch } from "@/server/egress/fetch";
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
  /** Preserve a captured Recon model literally; legacy generic callers still
   * receive the registry's historical alias compatibility behavior. */
  preserveModel?: boolean;
  maxTokens?: number;
  onResponseMetadata?: (metadata: {finishReason?: string}) => void;
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
  think?: boolean | string;
  contextWindow?: number;
  format?: Record<string, unknown>;
  maxResponseBytes?: number;
  rejectRedirects?: boolean;
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
    readonly code?: "STRUCTURED_OUTPUT_UNSUPPORTED" | "STRUCTURED_OUTPUT_INVALID_SCHEMA" | "THINKING_MODE_UNSUPPORTED" | "PROVIDER_HTTP_ERROR" | "INVALID_PROVIDER_RESPONSE" | "PROVIDER_REQUEST_FAILED",
    /** Allowlisted public provider error code only, never its response body. */
    readonly providerCode?: string,
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

  get reportTransportIdentity() { return {provider:this.config.provider, model:this.config.model ?? this.spec.defaultModel}; }

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
      throwIfScanAborted();
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
        throwIfScanAborted();
        lastErr = err;
        const retryable =
          err instanceof BrainError
            ? !["STRUCTURED_OUTPUT_UNSUPPORTED", "STRUCTURED_OUTPUT_INVALID_SCHEMA", "THINKING_MODE_UNSUPPORTED"].includes(err.code ?? "") && (err.status === undefined || isRetryableStatus(err.status))
            : true; // network/abort-type errors are retryable
        if (!retryable || attempt === retries) break;
        await delay(backoffMs(attempt));
      }
    }
    if (lastErr instanceof BrainError) throw lastErr;
    if (opts.format) throw new BrainError(
      opts.signal?.aborted || lastErr instanceof Error && /timeout|timed out|aborted/i.test(lastErr.message)
        ? "Provider request timed out or was cancelled"
        : "Provider request failed or returned invalid JSON",
      this.config.provider,
      undefined,
      lastErr instanceof SyntaxError ? "INVALID_PROVIDER_RESPONSE" : "PROVIDER_REQUEST_FAILED",
    );
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
    const aliased = opts.preserveModel ? undefined : this.spec.legacyAliases?.[model];
    return aliased ?? model;
  }

  private async doFetch(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    opts: ChatOptions,
  ): Promise<unknown> {
    throwIfScanAborted();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const scan = currentScanControl();
    let finished!: () => void;
    const done = new Promise<void>(resolve => { finished = resolve; });
    const release = scan?.track(async () => { controller.abort(); await done; });
    const signal = AbortSignal.any([controller.signal, ...(opts.signal ? [opts.signal] : []), ...(scan ? [scan.signal] : [])]);
    try {
      // M1: pinned, public-only (or operator-defined) and never redirected.
      const res = await guardedProviderFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (!res.ok) {
        const detail = opts.format ? await boundedErrorDetail(res) : await res.text().catch(() => "");
        if (opts.format) {
          const classified = structuredFailure(this.config.provider, this.spec.structuredOutput, res.status, detail);
          throw new BrainError(classified.message, this.config.provider, res.status, classified.code, classified.providerCode);
        }
        throw new BrainError(
          `${this.config.provider} HTTP ${res.status}${detail ? `: ${truncate(detail, 300)}` : ""}`,
          this.config.provider,
          res.status,
        );
      }
      if (!opts.maxResponseBytes) return await res.json();
      const reader=res.body!.getReader(); let size=0; const chunks:Uint8Array[]=[];
      try { while(true){const {done,value}=await reader.read(); if(done)break; size+=value.length;if(size>opts.maxResponseBytes)throw new Error('Provider response exceeds size limit');chunks.push(value);} }
      finally {await reader.cancel();}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      clearTimeout(timeout);
      finished(); release?.();
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
    if (opts.format && this.spec.structuredOutput === "OPENAI_JSON_SCHEMA") {
      body.response_format = { type: "json_schema", json_schema: { name: "bughunter_structured_response", strict: true, schema: opts.format } };
      if (this.config.provider === "OPENROUTER") body.provider = { require_parameters: true };
    }
    // DeepSeek V4 defaults thinking ON (bills extra); pin it explicitly off
    // unless the model name is the "reasoner" legacy alias.
    if (this.config.provider === "DEEPSEEK") {
      const alias = opts.preserveModel ? undefined : DEEPSEEK_LEGACY_ALIASES[model];
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
    )) as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
    const finish = json.choices?.[0]?.finish_reason;
    opts.onResponseMetadata?.({finishReason: ["stop","length","content_filter"].includes(finish??"") ? finish : undefined});
    return (json.choices?.[0]?.message?.content ?? "").trim();
  }

  private async chatOllama(
    system: string,
    user: string,
    opts: ChatOptions,
  ): Promise<string> {
    const host = this.baseUrl || process.env.OLLAMA_HOST;
    if (!host) throw new BrainError('Configure an explicit Ollama endpoint', this.config.provider);
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
        ...(opts.format ? {format:opts.format} : {}),
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
          num_ctx: opts.contextWindow ?? MAX_CTX,
        },
      },
      opts,
    )) as { message?: { content?: string } };
    return (json.message?.content ?? "").trim();
  }

  private async firstOllamaModel(host: string): Promise<string | null> {
    try {
      const res = await guardedProviderFetch(`${host}/api/tags`, { timeoutMs: 5000, signal: AbortSignal.any([AbortSignal.timeout(5000), ...(currentScanControl() ? [currentScanControl()!.signal] : [])]) });
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

async function boundedErrorDetail(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (bytes < 16384) { const item = await reader.read(); if (item.done) break; const chunk = item.value.subarray(0, 16384 - bytes); chunks.push(chunk); bytes += chunk.length; }
    return Buffer.concat(chunks).toString("utf8");
  } catch { return ""; } finally { await reader.cancel().catch(() => {}); }
}

function structuredFailure(provider: AiProviderName, policy: ProviderSpec["structuredOutput"], status: number, detail: string): { code: NonNullable<BrainError["code"]>; message: string; providerCode?: string } {
  let providerCode: string | undefined;
  try {
    const parsed = JSON.parse(detail), candidate = parsed?.error?.code ?? parsed?.code;
    const allowed = ["INVALID_ARGUMENT", "unsupported_parameter", "unsupported_value", "unsupported_response_format", "invalid_parameter", "invalid_request_error", "invalid_json_schema", "model_not_found", "not_found", "no_endpoints_found", "validation_error", "provider_error"];
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) providerCode = String(candidate);
    else if (typeof candidate === "string" && allowed.includes(candidate)) providerCode = candidate;
  } catch { /* The upstream body is inspected only for classification. */ }
  if (/\bINVALID_ARGUMENT\b/.test(detail)) providerCode = "INVALID_ARGUMENT";
  if (policy === "OLLAMA_FORMAT" && /thinking|think|token repeat|prediction aborted/i.test(detail)) return { code: "THINKING_MODE_UNSUPPORTED", message: "Ollama thinking control or decoder is incompatible with this request", providerCode };
  if (policy === "OPENAI_JSON_SCHEMA" && [400, 404, 422, 500].includes(status)) {
    if (/invalid_json_schema|invalid\s+(?:json\s+)?schema|schema[^\n]{0,80}(?:is invalid|not valid)/i.test(detail)) return { code: "STRUCTURED_OUTPUT_INVALID_SCHEMA", message: `${provider} rejected the structured-output schema`, providerCode };
    if (/(?:response[_ -]?format|json[_ -]?schema|structured[_ -]?(?:output|response)|require_parameters)[^\n]{0,160}(?:unsupported|not supported|not available|incompatible|unrecognized|unknown parameter)|(?:unsupported|not supported|does not support)[^\n]{0,160}(?:response[_ -]?format|json[_ -]?schema|structured)|no endpoints[^\n]{0,160}(?:support|parameters)/i.test(detail)) return { code: "STRUCTURED_OUTPUT_UNSUPPORTED", message: `${provider} has no compatible structured-output endpoint for the selected model`, providerCode };
  }
  return { code: "PROVIDER_HTTP_ERROR", message: `${provider} HTTP ${status}`, providerCode };
}

function backoffMs(attempt: number): number {
  // 0.5s, 1s, 2s … capped at 8s, with a little jitter.
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
