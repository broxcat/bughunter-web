import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { burpEndpoint } from './burp-proxy.mjs';
// Loopback or the installed operator endpoint only. No OAuth, redirects or
// cookies. Bound the whole operation AND decompressed SSE bytes.
export async function withBurp(action, timeoutMs = 3000, endpoint = burpEndpoint().url) {
  // endpoint parameter exists solely for disposable local protocol tests.
  const base = new URL(endpoint);
  if (!['127.0.0.1', new URL(burpEndpoint().url).hostname].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password || base.pathname !== '/') throw new Error('UNSAFE_ENDPOINT');
  const controller = new AbortController(); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  let total = 0;
  const boundedFetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== base.origin || url.username || url.password) throw new Error('UNSAFE_ENDPOINT');
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]) });
    if (!response.body) return response;
    const body = response.body.pipeThrough(new TransformStream({ transform(chunk, stream) {
      total += chunk.byteLength;
      if (total > 1024 * 1024) { controller.abort(); throw new Error('UPSTREAM_LIMIT'); }
      stream.enqueue(chunk);
    } }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const client = new Client({ name: 'bughunter-passive-burp', version: '1.0.0' });
  const transport = new SSEClientTransport(base, { fetch: boundedFetch, eventSourceInit: { fetch: boundedFetch } });
  // Do not relay extension errors/instructions/descriptions to Codex or logs.
  transport.onerror = () => {};
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport, { timeout: timeoutMs });
        const tools = await client.listTools({}, { timeout: timeoutMs });
        if (!tools.tools.some(tool => tool.name === 'get_proxy_http_history_regex')) throw new Error('INCOMPATIBLE');
        return await action(client);
      })(),
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(timedOut ? 'TIMEOUT' : 'UPSTREAM_LIMIT')), { once: true })),
    ]);
  } catch (error) {
    throw new Error(timedOut ? 'TIMEOUT' : ['INCOMPATIBLE', 'HISTORY_ACCESS_DENIED'].includes(error.message) ? error.message : 'UNAVAILABLE');
  } finally { clearTimeout(timer); controller.abort(); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}
