import { codexRead } from '../validator/codex-rpc.mjs';
import { claudeMcpStatus } from '../validator/claude-rpc.mjs';
import { withBurp } from '../validator/burp-upstream.mjs';
// Native discovery plus a live initialize/listTools handshake. A local bridge
// can list its static tools while Burp is down, which is never "connected".
export async function diagnoseProviderBurp(provider, cwd) {
  const base = { provider: provider === 'claude' ? 'Claude passive Burp MCP' : 'Codex Burp MCP', toolCount: 0 };
  try {
    const servers = provider === 'claude' ? (await claudeMcpStatus(cwd)).mcpServers : (await codexRead('mcpServerStatus/list', {}, cwd, 20000, true)).data;
    const server = servers?.find(s => s.name === 'bughunter_burp');
    if (!server) return { ...base, status: 'not configured', code: 'MCP_NOT_CONFIGURED' };
    const tools = Array.isArray(server.tools) ? server.tools.map(t => t.name) : Object.keys(server.tools ?? {});
    const officialTools = provider === 'codex' ? Object.keys(servers.find(s => s.name === 'burp')?.tools ?? {}) : [];
    if (provider === 'codex' && !officialTools.includes('get_proxy_http_history')) return { ...base, status: 'unavailable', code: 'MCP_OFFICIAL_DISCOVERY_FAILED' };
    if (!tools.includes('burp_status')) return { ...base, status: 'unavailable', code: 'MCP_DISCOVERY_FAILED' };
    await withBurp(async () => {}, 5000);
    return { ...base, status: 'connected', toolCount: tools.length };
  } catch {
    return { ...base, status: 'unavailable', code: 'MCP_TRANSPORT_OR_DISCOVERY_FAILED' };
  }
}
