import { PROVIDERS, type AiProviderName } from "./providers";
export async function testProviderConnection(
  input: {
    provider: AiProviderName;
    model: string;
    baseUrl: string;
    apiKey?: string;
  },
  send: typeof fetch = fetch,
) {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    return "Invalid base URL";
  }
  const spec = PROVIDERS[input.provider];
  if (!spec.keyless && !input.apiKey) return "Invalid API key";
  if (!input.model.trim()) return "Model unavailable";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...spec.extraHeaders,
  };
  let body: unknown;
  if (spec.kind === "anthropic") {
    url.pathname = url.pathname.replace(/\/$/, "") + "/v1/messages";
    headers["x-api-key"] = input.apiKey!;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: input.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "Reply OK" }],
    };
  } else if (spec.kind === "ollama") {
    url.pathname = url.pathname.replace(/\/$/, "") + "/api/chat";
    body = {
      model: input.model,
      stream: false,
      messages: [{ role: "user", content: "Reply OK" }],
      options: { num_predict: 1 },
    };
  } else {
    url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
    headers.Authorization = "Bearer " + input.apiKey;
    body = {
      model: input.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "Reply OK" }],
    };
  }
  try {
    const r = await send(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    await r.body?.cancel();
    if (r.ok) return "Connected";
    if ([401, 403].includes(r.status)) return "Invalid API key";
    if (r.status === 404) return "Model unavailable";
    return `Provider returned HTTP ${r.status}`;
  } catch (e) {
    return e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name)
      ? "Timeout"
      : "Endpoint unreachable";
  }
}
