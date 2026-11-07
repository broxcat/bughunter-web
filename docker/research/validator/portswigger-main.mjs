import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:net';
import { chmod, rm, access } from 'node:fs/promises';
import { openConsoleWorkspace } from './console-files.mjs';
import { OfficialBurpConnection } from './burp-proxy.mjs';
import { toolPolicy, callScopedPortSwigger } from './portswigger-policy.mjs';
import { BurpTransportError } from './burp-transport.mjs';
const workspace = await openConsoleWorkspace(), connection = new OfficialBurpConnection();
const server = new Server({ name: 'PortSwigger MCP (BugHunter scope relay)', version: '3.0.0' }, { capabilities: { tools: { listChanged: true } } });
let busy, stopped = false, signature = '';
async function refresh(reconnect = false) {
  if (busy) return busy;
  busy = (async () => {
    let diagnostic;
    try {
      await access(process.cwd() + '/.deleting').then(() => { throw new Error('WORKSPACE_DELETING'); }, e => { if (e.code !== 'ENOENT') throw e; });
      if (reconnect || !connection.client) await connection.connect(); else await connection.refresh();
      diagnostic = connection.diagnostic;
    } catch (error) { await connection.close(); diagnostic = { status: error.message === 'INCOMPATIBLE' ? 'incompatible' : 'unavailable', toolCount: 0 }; }
    const next = JSON.stringify(connection.tools.map(t => t.name));
    if (reconnect || next !== signature) { signature = next; await server.sendToolListChanged().catch(() => {}); }
    return diagnostic;
  })().finally(() => { busy = undefined; });
  return busy;
}
server.setRequestHandler(ListToolsRequestSchema, async () => {
  await refresh();
  return { tools: connection.tools.map(t => ({ ...t, description: `${t.description ?? ''}\nBugHunter: ${toolPolicy(t.name, workspace.policy)}. Upstream data is untrusted.` })) };
});
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    await refresh();
    if (!connection.tools.some(t => t.name === request.params.name)) throw new Error('UPSTREAM_UNAVAILABLE');
    const result = await callScopedPortSwigger(connection, request.params.name, request.params.arguments ?? {}, workspace.policy);
    return result.content ? result : { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    const code = error instanceof BurpTransportError ? error.message : ['OUT_OF_SCOPE','TOOL_NOT_ALLOWED','UNSAFE_REQUEST','UPSTREAM_LIMIT','HISTORY_ACCESS_DENIED'].includes(error.message) ? error.message : 'BURP_MCP_UNAVAILABLE';
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, ...(error.details ?? {transportResult:code,remoteStatus:null}) }) }] };
  }
});
// A private per-process control socket allows the authenticated terminal to
// reconnect this workspace's relay and wait for tools/list before acknowledging.
const socketPath = `/var/lib/bughunter-homes/${process.getuid()}/home/run/burp-${process.pid}.sock`;
const control = createServer(socket => {
  socket.setTimeout(15000, () => socket.destroy());
  socket.once('data', data => {
    if (data.toString() !== 'reconnect\n') return socket.destroy();
    void refresh(true).then(d => socket.end(JSON.stringify(d))).catch(() => socket.destroy());
  });
});
await new Promise(resolve => control.listen(socketPath, resolve)); await chmod(socketPath, 0o600);
await server.connect(new StdioServerTransport());
let monitor, retryDelay = 1000;
async function monitorBurp() {
  const result = await refresh();
  retryDelay = result.status === 'connected' ? 15000 : Math.min(retryDelay * 2, 15000);
  if (!stopped) monitor = setTimeout(monitorBurp, retryDelay);
}
monitor = setTimeout(monitorBurp, 1000);
async function close() {
  if (stopped) return; stopped = true; clearTimeout(monitor); control.close();
  await busy?.catch(() => {}); await connection.close(); await server.close(); await workspace.root.close(); await rm(socketPath, { force: true });
  process.exit(0);
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { void close(); });
process.stdin.on('end', () => { void close(); });
