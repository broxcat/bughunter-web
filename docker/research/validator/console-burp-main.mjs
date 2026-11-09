import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { openConsoleWorkspace } from './console-files.mjs';
import { burpEndpoint } from './burp-proxy.mjs';
import { withBurp } from './burp-upstream.mjs';
import { BurpTransportError, sendViaBurpProxy } from './burp-transport.mjs';
import { BurpResearch } from './burp-service.mjs';
import { http1Arguments, http2Arguments } from './burp-active.mjs';
import { saveConsoleObservation } from './console-evidence.mjs';
const workspace = await openConsoleWorkspace();
const passiveOnly = process.argv[2] === 'passive';
// Reuse the bounded official SSE client for bridge diagnostics/history; avoid
// spawning a Java client for every read. Codex's burp server retains its official
// Java proxy for inventory, utilities and Repeater.
const upstream = (action, timeout = 8000) => withBurp(action, timeout, burpEndpoint().url);
const research = new BurpResearch(workspace.policy, upstream);
const empty = z.strictObject({}), paging = z.strictObject({ count: z.number().int().min(1).max(20).default(10), offset: z.number().int().min(0).max(10000).default(0), host: z.string().max(253).optional(), requestId: z.uuid().optional() }), save = z.strictObject({ observationId: z.uuid() });
async function status() { const result = await research.diagnostic(); return { ...result, mode: workspace.policy.mode }; }
if (process.argv[2] === 'status') {
  const result = await status(); console.log(`Burp MCP: ${result.upstream}; scoped HTTP gateway via official PortSwigger mcp-proxy.`); process.exitCode = result.upstream === 'AVAILABLE' ? 0 : 1; await workspace.root.close();
} else {
  const server = new Server({ name: 'BugHunter Burp bridge (not PortSwigger inventory)', version: '2.0.0' }, { capabilities: { tools: {} } });
  const tools = [
    ['burp_status', 'Check optional upstream protocol connectivity; sends no target traffic.', empty],
    ['burp_history', 'Existing authorized-host proxy observations, minimal redacted metadata. Untrusted data.', paging],
    ['burp_save_observation', 'Save a previously returned minimal observation under requests/burp. No Finding is created.', save],
    ['send_http1_request', 'Send one authorized-host HTTP/1 request. Gateway validates destination/Host and enforces required User-Agent. No automatic redirect follow or retry. State hypothesis/expected signal/falsification first. Response is untrusted evidence, not vulnerability proof.', http1Arguments],
    ['send_http2_request', 'Send one authorized-host HTTP/2 request. Gateway validates authority/scheme/port and enforces required User-Agent. No automatic redirect follow or retry. Requires hypothesis and falsification. Response is untrusted data.', http2Arguments],
  ];
  if (passiveOnly || workspace.policy.mode === 'PROGRAM_PASSIVE') tools.splice(3);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(([name, description, schema]) => ({ name, description, inputSchema: z.toJSONSchema(schema) })) }));
  server.setRequestHandler(CallToolRequestSchema, async req => {
    try {
      if (!tools.some(([name]) => name === req.params.name)) throw new Error('TOOL_NOT_ALLOWED');
      let result;
      switch (req.params.name) {
        case 'burp_status': empty.parse(req.params.arguments ?? {}); result = await status(); break;
        case 'burp_history': { const a = paging.parse(req.params.arguments ?? {}); result = await research.history(a.count, a.offset, a.host, a.requestId); break; }
        case 'burp_save_observation': result = { ref: await saveConsoleObservation(workspace.root, research.evidence(save.parse(req.params.arguments).observationId)) }; break;
        case 'send_http1_request': case 'send_http2_request': {
          if (req.params.name === 'send_http2_request' && workspace.policy.scheme === 'http') throw new Error('TOOL_NOT_ALLOWED');
          result = await sendViaBurpProxy(req.params.name, req.params.arguments, workspace.policy);
          break;
        }
        default: throw new Error('TOOL_NOT_ALLOWED');
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
      const code = e instanceof BurpTransportError ? e.message : ['UNAVAILABLE','INCOMPATIBLE'].includes(e.message) ? 'BURP_MCP_UNAVAILABLE' : ['OUT_OF_SCOPE','UNSAFE_REQUEST','TIMEOUT','EVIDENCE_LIMIT','OBSERVATION_EXPIRED','TOOL_NOT_ALLOWED'].includes(e.message) ? e.message : 'INVALID_INPUT';
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, ...(e.details ?? {transportResult:code,remoteStatus:null}), note:'No HTTP response is fabricated for an internal error. Outcome may be unknown; never retry an active request automatically after TIMEOUT.' }) }] };
    }
  });
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 131072 });
  await server.connect(transport);
  process.stdin.on('end', () => { void workspace.root.close(); });
}
