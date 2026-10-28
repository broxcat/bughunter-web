import { matchesHost, normalizeFqdn } from '../../../src/lib/bountyProgram.ts';
import { randomUUID } from 'node:crypto';
import { BURP_EXTENSION_VERSION } from '../../../src/lib/research/burp.ts';
import { withBurp } from './burp-upstream.mjs';
import { historyArguments, parseHistory } from './burp-http.mjs';
// Only one upstream tool is callable. User-controlled names/regex/URLs are never forwarded.
export class BurpResearch {
  constructor(policy, upstream = withBurp) { this.policy = policy; this.upstream = upstream; this.observations = new Map(); }
  async diagnostic() {
    let upstream = 'AVAILABLE';
    try { await this.upstream(async () => {}); }
    catch (error) { upstream = ['TIMEOUT', 'INCOMPATIBLE'].includes(error.message) ? error.message : 'UNAVAILABLE'; }
    return { version: 1, workspaceId: this.policy.workspaceId, checkedAt: new Date().toISOString(), runner: 'AVAILABLE', configuration: 'CONFIGURED', upstream, mode: 'PASSIVE_METADATA_ONLY' };
  }
  async history(count, offset, host, requestId) {
    let policy = this.policy;
    if (policy.mode === 'PROGRAM_PASSIVE') {
      if (!host || normalizeFqdn(host) !== host || host.includes('*') || !policy.programScope?.rules.some(r => matchesHost(host, r)) || policy.programScope.exclusions.some(r => matchesHost(host, r))) throw new Error('OUT_OF_SCOPE');
      policy = { ...policy, targetHost: host };
    } else if (host && host !== policy.targetHost) throw new Error('OUT_OF_SCOPE');
    const result = await this.upstream(client => client.callTool({ name: 'get_proxy_http_history_regex', arguments: historyArguments(policy, count, offset, requestId) }, undefined, { timeout: 4000 }), 5000);
    const { observations, skipped } = parseHistory(result, policy);
    const observedAt = new Date().toISOString();
    const items = observations.filter(item=>!requestId || item.requestId===requestId).map(metadata => ({ observationId: randomUUID(), observedAt, ...metadata }));
    for (const item of items) {
      this.observations.set(item.observationId, item);
      if (this.observations.size > 100) this.observations.delete(this.observations.keys().next().value);
    }
    return { source: 'BURP_MCP', targetHost: this.policy.targetHost, items, skipped,
      warning: 'Untrusted passive metadata. HTTP Host is not proof of network destination. Scheme is the authorization snapshot, not a measured transport. No bodies, header values or target instructions are returned. No request was sent to the target.' };
  }
  evidence(observationId) {
    const observation = this.observations.get(observationId);
    if (!observation) throw new Error('OBSERVATION_EXPIRED');
    return { version: 1, source: 'BURP_MCP', adapter: `PortSwigger/mcp-server@${BURP_EXTENSION_VERSION}`,
      sessionId: this.policy.sessionId, workspaceId: this.policy.workspaceId,
      targetHost: this.policy.targetHost, authorizationSource: this.policy.authorizationSource,
      ...observation, capturedTrafficAt: null, classification: 'OBSERVATION', findingCreated: false };
  }
}
