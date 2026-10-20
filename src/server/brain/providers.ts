// Multi-provider registry — ported from the Agentic-Bug-Hunter CLI brain.py
// (LLMClient). Maps each AiProvider enum value to its API shape, default base
// URL, default model, attribution headers, and legacy model aliases.
//
// The web app exposes 11 providers (prisma enum AiProvider). The CLI's internal
// names "claude"/"grok" map to ANTHROPIC/XAI here.

export type ProviderKind = "anthropic" | "openai" | "ollama";

export type AiProviderName =
  | "OLLAMA"
  | "GROQ"
  | "DEEPSEEK"
  | "ANTHROPIC"
  | "OPENAI"
  | "XAI"
  | "OPENROUTER"
  | "ORCAROUTER"
  | "FLUXION"
  | "LITELLM"
  | "REQUESTY";

export interface ProviderSpec {
  /** Which request/response shape the provider speaks. */
  kind: ProviderKind;
  /** Default API base URL. null for Ollama (resolved from OLLAMA_HOST/localhost). */
  defaultBaseUrl: string | null;
  /** Default model. null for Ollama (resolved dynamically). */
  defaultModel: string | null;
  /** True for keyless providers (Ollama, local). */
  keyless?: boolean;
  /** Extra headers (e.g. gateway attribution). */
  extraHeaders?: Record<string, string>;
  /** Retired-model → current-model remaps (saved configs keep working). */
  legacyAliases?: Record<string, string>;
}

// From brain.py GROQ_LEGACY_ALIASES — every id past its shutdown date.
const GROQ_LEGACY_ALIASES: Record<string, string> = {
  "mixtral-8x7b-32768": "openai/gpt-oss-20b",
  "gemma2-9b-it": "openai/gpt-oss-20b",
  "llama3-70b-8192": "openai/gpt-oss-120b",
  "llama3-8b-8192": "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
};

// From brain.py GROK_LEGACY_ALIASES — retired xAI models.
const GROK_LEGACY_ALIASES: Record<string, string> = {
  "grok-2-latest": "grok-4.5",
  "grok-2": "grok-4.5",
  "grok-3": "grok-4.3",
  "grok-3-mini": "grok-4.3",
};

const ATTRIBUTION_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://github.com/broxcat/Agentic-Bug-Hunter",
  "X-Title": "BugHunter",
};

export const PROVIDERS: Record<AiProviderName, ProviderSpec> = {
  OLLAMA: {
    kind: "ollama",
    defaultBaseUrl: null,
    defaultModel: null,
    keyless: true,
  },
  ANTHROPIC: {
    kind: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
  },
  OPENAI: {
    kind: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
  XAI: {
    kind: "openai",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.5",
    legacyAliases: GROK_LEGACY_ALIASES,
  },
  GROQ: {
    kind: "openai",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-20b",
    legacyAliases: GROQ_LEGACY_ALIASES,
  },
  DEEPSEEK: {
    kind: "openai",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
  },
  OPENROUTER: {
    kind: "openai",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4.6",
    extraHeaders: ATTRIBUTION_HEADERS,
  },
  ORCAROUTER: {
    kind: "openai",
    defaultBaseUrl: "https://api.orcarouter.ai/v1",
    defaultModel: "openai/gpt-4o",
    extraHeaders: ATTRIBUTION_HEADERS,
  },
  FLUXION: {
    kind: "openai",
    defaultBaseUrl: "https://fluxionai.world/v1",
    defaultModel: "openai/gpt-4o",
    extraHeaders: ATTRIBUTION_HEADERS,
  },
  REQUESTY: {
    kind: "openai",
    defaultBaseUrl: "https://router.requesty.ai/v1",
    defaultModel: "anthropic/claude-sonnet-4-6",
    extraHeaders: ATTRIBUTION_HEADERS,
  },
  // LiteLLM: in the web app this targets a LiteLLM proxy (OpenAI-compatible) via
  // the config's baseUrl; the model id carries the provider prefix as usual.
  LITELLM: {
    kind: "openai",
    defaultBaseUrl: null,
    defaultModel: "gpt-4o",
  },
};

/** DeepSeek V4 defaults thinking ON (bills extra). Keep it off unless asked. */
export const DEEPSEEK_LEGACY_ALIASES: Record<
  string,
  { model: string; thinking: boolean }
> = {
  "deepseek-chat": { model: "deepseek-v4-flash", thinking: false },
  "deepseek-reasoner": { model: "deepseek-v4-flash", thinking: true },
};
