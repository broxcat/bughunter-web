// Capability fingerprint, not a fixed tool count or an edition requirement.
export const coreBurpTools = ['get_proxy_http_history', 'get_proxy_http_history_regex', 'send_http1_request', 'send_http2_request', 'create_repeater_tab'];
export function burpInventory(tools, server) {
  const names = tools.map(t => t.name);
  const missing = coreBurpTools.filter(name => !names.includes(name));
  return { status: missing.length ? 'incompatible' : 'connected', provider: 'PortSwigger MCP',
    version: server?.version ?? null, tools: names, toolCount: names.length, missing,
    optional: { scanner: names.includes('get_scanner_issues'), collaborator: names.includes('generate_collaborator_payload') } };
}
