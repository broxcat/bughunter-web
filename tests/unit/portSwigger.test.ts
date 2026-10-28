import { describe, it, expect, vi } from 'vitest';
import { burpInventory, coreBurpTools } from '../../docker/research/validator/burp-inventory.mjs';
import { callScopedPortSwigger, allowedHistoryHost, toolPolicy } from '../../docker/research/validator/portswigger-policy.mjs';
import { consoleCodexConfig } from '@/lib/research/consolePolicy';
const policy = { mode: 'SCOPED_ACTIVE_HTTP', targetHost: 'app.example.test', scheme: 'https', port: 443, requiredUserAgent: 'Research-Test/1', programScope: { rules: ['*.example.test'], exclusions: ['admin.example.test', '*.internal.example.test'] } };
const program = { ...policy, mode: 'PROGRAM_PASSIVE' };
const item = (host: string) => ({ request: `GET /proof?token=SECRET HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Research-Test/1\r\nCookie: SECRET\r\n\r\n`, response: 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nSECRET', notes: 'SECRET' });
describe('real PortSwigger inventory, independent of BugHunter bridge', () => {
  it.each([{names:[]}, {names:['burp_status','burp_history','burp_save_observation']}, {names:['get_proxy_http_history_regex']}])('rejects incomplete inventory %j', ({names}) => {
    expect(burpInventory(names.map(name => ({ name })), {}).status).toBe('incompatible');
  });
  it('accepts Community core without a fixed count or Professional-only tools', () => {
    expect(burpInventory(coreBurpTools.map(name => ({ name })), { version: '1.3.0' })).toMatchObject({ status: 'connected', version: '1.3.0', toolCount: 5, optional: { scanner: false, collaborator: false } });
  });
  it.each([true,false])('automatically configures separate Burp and bridge in passive=%s consoles', passive => {
    const config = consoleCodexConfig('research_target','Read scope.md',passive);
    expect(config).toContain('[mcp_servers.burp]'); expect(config).toContain('bughunter-portswigger-mcp'); expect(config).toContain('[mcp_servers.bughunter_burp]');
    expect(config).not.toContain('mcp_servers.burp.enabled_tools');
  });
});
describe('PortSwigger scope relay', () => {
  it('filters shared proxy history, exclusions and secrets before exposing metadata', async () => {
    const connection = { call: vi.fn(async () => ({ content: [{ type: 'text', text: ['app.example.test','api.example.test','admin.example.test','foo.internal.example.test','example.test','example.test.attacker.net'].map(host => JSON.stringify(item(host))).join('\n\n') }] })) };
    const result = await callScopedPortSwigger(connection,'get_proxy_http_history',{count:10,offset:0},program);
    expect(result.items.map((i: {url:string}) => i.url)).toEqual(['https://app.example.test/proof?token=%5BREDACTED%5D','https://api.example.test/proof?token=%5BREDACTED%5D']);
    expect(JSON.stringify(result)).not.toContain('SECRET'); expect(result.skipped).toBe(4);
    const hostResult = await callScopedPortSwigger(connection,'get_proxy_http_history',{count:10,offset:0},policy);
    expect(hostResult.items).toHaveLength(1);
  });
  it.each(['send_http1_request','send_http2_request','create_repeater_tab','send_to_intruder','set_proxy_intercept_state','set_project_options','unknown_tool','get_proxy_websocket_history'])('blocks %s before upstream when passive or unattributable', async name => {
    const connection = { call: vi.fn() };
    await expect(callScopedPortSwigger(connection,name,{},program)).rejects.toThrow('TOOL_NOT_ALLOWED'); expect(connection.call).not.toHaveBeenCalled();
  });
  it('guards real send and Repeater tools with the same destination and UA policy', async () => {
    const connection = { call: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{content: {type: string; text: string}[]}>>().mockResolvedValue({content:[{type:'text',text:'OK'}]}) };
    const args = {targetHostname:'app.example.test',targetPort:443,usesHttps:true,content:'GET / HTTP/1.1\r\nHost: app.example.test\r\nUser-Agent: Wrong\r\n\r\n'};
    await callScopedPortSwigger(connection,'create_repeater_tab',{...args,tabName:'controlled'},policy);
    expect(String(connection.call.mock.calls[0][1].content)).toContain('User-Agent: Research-Test/1');
    expect(connection.call.mock.calls[0][1].tabName).toBe('controlled');
    connection.call.mockClear();
    await expect(callScopedPortSwigger(connection,'send_http1_request',{...args,targetHostname:'evil.example.test'},policy)).rejects.toThrow('OUT_OF_SCOPE'); expect(connection.call).not.toHaveBeenCalled();
    await expect(callScopedPortSwigger(connection,'create_repeater_tab',args,{...policy,programScope:{rules:[],exclusions:['app.example.test']}})).rejects.toThrow('OUT_OF_SCOPE'); expect(connection.call).not.toHaveBeenCalled();
  });
  it('does not retry a failed active call', async () => {
    const connection = {call:vi.fn(async()=>{throw new Error('disconnect');})};
    await expect(callScopedPortSwigger(connection,'send_http1_request',{targetHostname:'app.example.test',targetPort:443,usesHttps:true,content:'GET / HTTP/1.1\r\nHost: app.example.test\r\n\r\n'},policy)).rejects.toThrow('disconnect');
    expect(connection.call).toHaveBeenCalledTimes(1);
  });
  it('retains wildcard boundaries and fails closed for unattributable global tools',()=>{
    expect(allowedHistoryHost('notexample.test',program)).toBe(false); expect(allowedHistoryHost('api.example.test',program)).toBe(true);
    expect(toolPolicy('get_active_editor_contents',policy)).toMatch(/^Blocked/);
  });
});
