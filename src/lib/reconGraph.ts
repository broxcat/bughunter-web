import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeFqdn } from './bountyProgram';
import { canonicalReconUrl, type ReconArtifactData } from './reconArtifacts';
import { safeSurfaceUrl,type SafeAuthSurface } from './authenticatedRecon';

export type ReconGraphNode = {
  id: string; type: 'HOSTNAME' | 'IP' | 'ENDPOINT' | 'PARAMETER' | 'SERVICE' | 'TECHNOLOGY' | 'AUTH_CONTEXT';
  value: string; inScope: boolean; evidenceRefs: string[]; firstSeenAt: string; lastSeenAt: string;
  contextKey?:string;contextMode?:'ANONYMOUS'|'AUTHENTICATED';persona?:string|null;urlRedacted?:boolean;
};
export type ReconGraphEdge = {
  id: string; from: string; to: string;
  relation: 'RESOLVES_TO' | 'CNAME' | 'REFERENCES' | 'CALLS' | 'HAS_PARAMETER' |
    'AUTHENTICATION_SURFACE' | 'RESET_ROUTE' | 'HOSTS_SERVICE' | 'USES_TECHNOLOGY' | 'OBSERVED_IN_CONTEXT';
  verification: 'OBSERVED' | 'DISCOVERED' | 'DECLARED'; evidenceRefs: string[];
  firstSeenAt: string; lastSeenAt: string;
  responseClass?:string;statusCode?:number;
};
export type ReconAssetGraph = { version: 1; authorizationGranted: false; nodes: ReconGraphNode[]; edges: ReconGraphEdge[]; truncated: boolean };

/** Derived relationships only. DNS/CDN/remote references never authorize the
 * destination and do not prove common ownership. IPs remain documentary. */
export function deriveAssetGraph(artifacts: ReconArtifactData[], limits = { nodes: 1000, edges: 2000 },authenticated:SafeAuthSurface[]=[]): ReconAssetGraph {
  const nodes = new Map<string, ReconGraphNode>(), edges = new Map<string, ReconGraphEdge>(); let truncated = false;
  const ordered = [...artifacts].sort((a, b) => a.kind.localeCompare(b.kind) || a.canonicalKey.localeCompare(b.canonicalKey) || (a.id ?? '').localeCompare(b.id ?? ''));
  const unique = (values: string[]) => [...new Set(values)].sort();
  for (const artifact of ordered) {
    if (!artifact.id) continue; // A relationship without a retrievable source is not evidence.
    const value = artifact.value, evidenceRefs = [artifact.id];
    const node = (type: ReconGraphNode['type'], value: string, inScope: boolean) => {
      const id = `${type.toLowerCase()}:` + createHash('sha256').update(value).digest('hex');
      const old = nodes.get(id);
      if (old) {
        old.inScope ||= inScope; old.evidenceRefs = unique([...old.evidenceRefs, ...evidenceRefs]);
        old.firstSeenAt = [old.firstSeenAt, artifact.firstSeenAt].sort()[0]; old.lastSeenAt = [old.lastSeenAt, artifact.lastSeenAt].sort().at(-1)!;
        return id;
      }
      if (nodes.size >= limits.nodes) { truncated = true; return null; }
      nodes.set(id, { id, type, value, inScope, evidenceRefs, firstSeenAt: artifact.firstSeenAt, lastSeenAt: artifact.lastSeenAt }); return id;
    };
    const edge = (from: string | null, to: string | null, relation: ReconGraphEdge['relation']) => {
      if (!from || !to) return;
      const id = 'edge:' + createHash('sha256').update(`${relation}\0${from}\0${to}`).digest('hex'), old = edges.get(id);
      if (old) {
        old.evidenceRefs = unique([...old.evidenceRefs, ...evidenceRefs]);
        old.firstSeenAt = [old.firstSeenAt, artifact.firstSeenAt].sort()[0]; old.lastSeenAt = [old.lastSeenAt, artifact.lastSeenAt].sort().at(-1)!;
        if (artifact.verification === 'OBSERVED') old.verification = 'OBSERVED';
      } else if (edges.size >= limits.edges) truncated = true;
      else edges.set(id, { id, from, to, relation, verification: artifact.verification, evidenceRefs, firstSeenAt: artifact.firstSeenAt, lastSeenAt: artifact.lastSeenAt });
    };
    const host = (raw: unknown, inScope = false) => {
      if (typeof raw !== 'string') return null;
      try { const hostname = normalizeFqdn(raw); return hostname.startsWith('*.') ? null : node('HOSTNAME', hostname, inScope); } catch { return null; }
    };
    const url = (raw: unknown, inScope = false) => {
      if (typeof raw !== 'string') return null;
      try { return node('ENDPOINT', canonicalReconUrl(raw), inScope); } catch { return null; }
    };
    const inScope = artifact.scopeState === 'IN_SCOPE';
    if (value.type === 'dns-address' && Array.isArray(value.addresses)) {
      const from = host(value.hostname, inScope);
      for (const address of value.addresses) if (typeof address === 'string' && isIP(address)) edge(from, node('IP', address, false), 'RESOLVES_TO');
    }
    if (artifact.kind === 'hostname' && value.relationship === 'CNAME') {
      edge(host(value.origin), host(value.hostname, inScope), 'CNAME');
    }
    if (artifact.kind === 'hostname') host(value.hostname, inScope);
    if (typeof value.url === 'string') {
      const endpoint = url(value.url, inScope);
      if (!endpoint) continue;
      const reference = value.discoveredFrom ?? value.sourceUrl ?? value.origin;
      if (typeof reference === 'string' && reference.startsWith('http')) edge(url(reference), endpoint,
        value.relationship === 'calls' && artifact.verification === 'OBSERVED' ? 'CALLS' : 'REFERENCES');
      if (artifact.kind === 'parameter' && typeof value.name === 'string') {
        edge(endpoint, node('PARAMETER', `${canonicalReconUrl(value.url)}#${value.name}`, inScope), 'HAS_PARAMETER');
      }
      if (artifact.kind === 'auth-surface') {
        const hostname = new URL(value.url).hostname;
        edge(host(hostname, inScope), endpoint, /(?:reset|forgot)[-_\/]?(?:password)?/i.test(new URL(value.url).pathname) ? 'RESET_ROUTE' : 'AUTHENTICATION_SURFACE');
      }
    }
    if (['port', 'service'].includes(artifact.kind) && typeof value.port === 'number' && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 && typeof value.hostname === 'string') {
      edge(host(value.hostname, inScope), node('SERVICE', `${value.hostname}:${value.port}/${value.protocol ?? 'tcp'}`, inScope), 'HOSTS_SERVICE');
    }
    if (artifact.kind === 'technology' && typeof value.name === 'string') {
      edge(host(value.hostname, inScope), node('TECHNOLOGY', value.name, false), 'USES_TECHNOLOGY');
    }
  }
  for(const surface of [...authenticated].sort((a,b)=>a.scanRunId.localeCompare(b.scanRunId))){
    if(surface.legacy)continue;
    for(const observation of [...surface.observations].sort((a,b)=>(a.id??'').localeCompare(b.id??''))){
      const context=surface.contexts.find(item=>item.contextKey===observation.contextKey);
      if(!context||!observation.id||observation.responseClass==='UNAVAILABLE'||!observation.statusCode)continue;
      const refs=['ReconSurfaceObservation:'+observation.id],at=observation.observedAt;
      let url:string;try{url=canonicalReconUrl(safeSurfaceUrl(observation.url));}catch{continue;}
      const identity=observation.urlRedacted?'context-surface:'+observation.canonicalKey:url;
      const endpointId='endpoint:'+createHash('sha256').update(identity).digest('hex'),contextId='auth_context:'+createHash('sha256').update(surface.scanRunId+'\0'+context.contextKey).digest('hex');
      const addNode=(id:string,row:Omit<ReconGraphNode,'id'>)=>{const old=nodes.get(id);if(old){old.evidenceRefs=unique([...old.evidenceRefs,...refs]);old.firstSeenAt=[old.firstSeenAt,at].sort()[0];old.lastSeenAt=[old.lastSeenAt,at].sort().at(-1)!;return true;}if(nodes.size>=limits.nodes){truncated=true;return false;}nodes.set(id,{id,...row});return true;};
      const label=context.mode==='ANONYMOUS'?'Anonymous':`Authenticated context ${[...surface.contexts].filter(item=>item.mode==='AUTHENTICATED').sort((a,b)=>a.contextKey.localeCompare(b.contextKey)).findIndex(item=>item.contextKey===context.contextKey)+1}`;
      if(!addNode(endpointId,{type:'ENDPOINT',value:url,inScope:false,evidenceRefs:refs,firstSeenAt:at,lastSeenAt:at,...(observation.urlRedacted?{urlRedacted:true}:{})})||!addNode(contextId,{type:'AUTH_CONTEXT',value:label,contextKey:context.contextKey,contextMode:context.mode,inScope:false,evidenceRefs:refs,firstSeenAt:at,lastSeenAt:at}))continue;
      const id='edge:'+createHash('sha256').update('OBSERVED_IN_CONTEXT\0'+endpointId+'\0'+contextId).digest('hex'),old=edges.get(id);
      if(old){old.evidenceRefs=unique([...old.evidenceRefs,...refs]);old.firstSeenAt=[old.firstSeenAt,at].sort()[0];old.lastSeenAt=[old.lastSeenAt,at].sort().at(-1)!;}
      else if(edges.size<limits.edges)edges.set(id,{id,from:endpointId,to:contextId,relation:'OBSERVED_IN_CONTEXT',verification:'OBSERVED',evidenceRefs:refs,firstSeenAt:at,lastSeenAt:at,responseClass:observation.responseClass,statusCode:observation.statusCode});else truncated=true;
    }
  }
  return { version: 1, authorizationGranted: false, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)), truncated };
}
