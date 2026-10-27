import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// Official pinned PortSwigger proxy. No retries of active requests or arbitrary command/URL.
export async function withOfficialBurp(action, timeoutMs = 4000) {
  const client = new Client({ name: 'bughunter-scoped-burp', version: '2.0.0' });
  const transport = new StdioClientTransport({ command: '/usr/bin/java', args: ['-Xms16m', '-Xmx128m', '-Dorg.slf4j.simpleLogger.defaultLogLevel=off', '-jar', '/opt/portswigger/mcp-proxy-all.jar', '--sse-url', 'http://127.0.0.1:9876/'], stderr: 'pipe', maxBufferSize: 1024 * 1024 });
  transport.stderr?.on('data', () => {});
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport, { timeout: timeoutMs });
        transport.stderr?.on('data', () => {}); // Raw upstream diagnostics never reach Codex/logs.
        const tools = await client.listTools({}, { timeout: timeoutMs });
        if (!tools.tools.some(t => t.name === 'get_proxy_http_history_regex')) throw new Error('INCOMPATIBLE');
        return await action(client);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); }),
    ]);
  } catch (e) { throw new Error(e.code === ErrorCode.RequestTimeout ? 'TIMEOUT' : ['TIMEOUT','INCOMPATIBLE','OUT_OF_SCOPE'].includes(e.message) ? e.message : 'UNAVAILABLE'); }
  finally {
    clearTimeout(timer);
    // Stdio transport terminates its own child (including on timeout); no orphan Java.
    await client.close().catch(() => {}); await transport.close().catch(() => {});
  }
}
