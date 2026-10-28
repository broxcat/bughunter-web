import { burpSettings } from './burp-settings.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connect } from 'node:net';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { burpInventory } from './burp-inventory.mjs';

// Operator configuration only. Compose shares Burp's network namespace, never
// its PID namespace. Neither the MCP nor proxy port is published.
export function burpEndpoint() {
  const settings = burpSettings();
  const host = settings.BURP_MCP_HOST ?? '127.0.0.1', port = Number(settings.BURP_MCP_PORT ?? 9876);
  if (!/^(?:127\.0\.0\.1|localhost|[a-zA-Z0-9][a-zA-Z0-9.-]{0,252})$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UNAVAILABLE');
  return { host, port, url: `http://${host}:${port}/` };
}
export class OfficialBurpConnection {
  constructor(timeoutMs = 8000) { this.timeoutMs = timeoutMs; this.tools = []; }
  async close() {
    const client = this.client, transport = this.transport;
    this.client = undefined; this.transport = undefined; this.tools = [];
    await client?.close().catch(() => {}); await transport?.close().catch(() => {});
  }
  async connect() {
    if (this.pending) return this.pending;
    this.pending = this.open().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async open() {
    await this.close();
    let timer;
    try {
      const endpoint = burpEndpoint();
      // Absence differs from a responsive MCP with an empty inventory.
      await new Promise((resolve, reject) => {
        const socket = connect(endpoint.port, endpoint.host);
        socket.setTimeout(1000); socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('error', () => { socket.destroy(); reject(new Error('UNAVAILABLE')); });
        socket.once('timeout', () => { socket.destroy(); reject(new Error('UNAVAILABLE')); });
      });
      this.client = new Client({ name: 'bughunter-portswigger-relay', version: '3.0.0' });
      this.transport = new StdioClientTransport({ command: '/usr/bin/java', args: ['-Xms16m', '-Xmx128m', '-Dorg.slf4j.simpleLogger.defaultLogLevel=off', '-jar', '/opt/portswigger/mcp-proxy-all.jar', '--sse-url', endpoint.url], stderr: 'pipe' });
      this.transport.stderr?.on('data', () => {});
      await Promise.race([
        (async () => { await this.client.connect(this.transport); await this.refresh(); })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), this.timeoutMs); }),
      ]);
      return this.diagnostic;
    } catch (error) {
      await this.close();
      throw new Error(['TIMEOUT', 'INCOMPATIBLE'].includes(error.message) ? error.message : 'UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  async refresh() {
    const tools = [], seen = new Set(); let cursor;
    for (let page = 0; page < 10; page++) {
      const result = await this.client.listTools(cursor ? { cursor } : {}, { timeout: this.timeoutMs });
      for (const tool of result.tools) { if (seen.has(tool.name) || tools.length >= 200) throw new Error('INCOMPATIBLE'); seen.add(tool.name); tools.push(tool); }
      cursor = result.nextCursor; if (!cursor) break;
      if (page === 9) throw new Error('INCOMPATIBLE');
    }
    this.diagnostic = burpInventory(tools, this.client.getServerVersion());
    if (this.diagnostic.status !== 'connected') throw new Error('INCOMPATIBLE');
    // The official Java proxy caches tool schemas. An upstream local utility
    // proves the SSE connection is alive without target traffic or approval
    // dialogs; listing that cache alone cannot detect a disconnected Burp.
    if (seen.has('url_encode')) {
      const response = await this.client.callTool({ name: 'url_encode', arguments: { content: '' } }, undefined, { timeout: this.timeoutMs });
      if (response.isError) throw new Error('UNAVAILABLE');
    }
    this.tools = tools;
    return this.diagnostic;
  }
  async call(name, args) {
    if (!this.client) await this.connect();
    // No retries: a failed active call may already have had side effects.
    return this.client.callTool({ name, arguments: args }, undefined, { timeout: 12000 });
  }
}
export async function withOfficialBurp(action, timeoutMs = 8000) {
  const connection = new OfficialBurpConnection(timeoutMs);
  let timer;
  try {
    return await Promise.race([
      (async () => { await connection.connect(); return await action(connection.client, connection.diagnostic); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); }),
    ]);
  } catch (error) { throw new Error(error.code === ErrorCode.RequestTimeout ? 'TIMEOUT' : ['TIMEOUT','INCOMPATIBLE','OUT_OF_SCOPE'].includes(error.message) ? error.message : 'UNAVAILABLE'); }
  finally { clearTimeout(timer); await connection.close(); }
}
export async function diagnoseOfficialBurp() {
  try { return await withOfficialBurp(async (_, diagnostic) => diagnostic); }
  catch (error) { return { provider: 'PortSwigger MCP', status: error.message === 'INCOMPATIBLE' ? 'incompatible' : 'unavailable', code: error.message, toolCount: 0 }; }
}
