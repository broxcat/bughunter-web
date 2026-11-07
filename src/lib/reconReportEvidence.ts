import type { ReportFacts } from './reconReportModel';
import { redactObservationText } from './observationSafety';
import { assetAllowsHost, detectScopeAsset } from './scopeAssets';
import { isExcluded } from './bountyProgram';

const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? redactObservationText(v.trim()).slice(0,4096) : null;
const values = (v: unknown) => Array.isArray(v) ? v.flatMap(x => text(x) ? [text(x)!] : []).slice(0,40) : [];
export function staticCategory(raw: string): string | null {
  try {
    const path = new URL(raw).pathname;
    if (/\.map$/i.test(path)) return 'Source maps';
    if (/\.(?:m?js)$/i.test(path)) return 'JavaScript';
    if (/\.css$/i.test(path)) return 'CSS';
    if (/manifest|\.webmanifest$/i.test(path)) return 'Manifests';
    if (/\.(?:json|xml|ya?ml|txt)$/i.test(path)) return 'Machine-readable assets';
    if (/\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i.test(path) || /\/_next\/static\//i.test(path)) return 'Other static assets';
  } catch { /* No URL or DNS fact is inferred from an invalid resource. */ }
  return null;
}
export type ReportProvenance = { entity:'ReconArtifact'|'ReconSurfaceObservation'|'ReconPipelineStep'; id: string | null; scanRunId: string | null; scopeAssetId: string | null; runId: string; host: string; kind: string; fact: string; verification: string; scopeState: string; sources: string[]; firstSeenAt: string | null; lastSeenAt: string | null };
export function buildReportEvidence(facts: ReportFacts) {
  const provenance: ReportProvenance[] = [];
  const dnsRecords: Array<{host:string;recordType:string|null;value:string|null;relationship:string;refs:string[]}> = [];
  const tls: Array<{host:string;properties:Array<{name:string;value:string}>;refs:string[]}> = [];
  const redirects: Array<{from:string|null;to:string;refs:string[]}> = [];
  const categories = new Map<string,Map<string,string[]>>();
  for (const scan of facts.scans) for (const artifact of scan.artifacts) {
    const v = artifact.value, host = text(v.hostname) ?? text(v.host), url = text(v.url);
    const refs = artifact.id ? [artifact.id] : [];
    const sources = Array.isArray(artifact.sources) ? artifact.sources.slice(0,8).map(s => {
      const r = s && typeof s === 'object' ? s as Record<string,unknown> : {};
      return ['tool','provider','sourceRef','observedAt'].flatMap(key=>text(r[key])?[`${key}: ${text(r[key])}`]:[]).join(' · ');
    }).filter(Boolean) : [];
    const relationship = (name:string) => {
      if (isExcluded(name,facts.program.outOfScope)) return 'Excluded (captured policy)';
      const asset=facts.authorizedAssets.find(pattern=>{try{return assetAllowsHost(detectScopeAsset(pattern),name);}catch{return false;}});
      if(asset)return detectScopeAsset(asset).format==='URL'?'Host of a captured URL asset; path restrictions remain authoritative':'Authorized host (captured Scope); recheck current Scope before new work';
      return 'Observed/discovered; authorization unknown or out of scope';
    };
    let fact = [artifact.kind,host,url,text(v.name)].filter(Boolean).join(' · ');
    if (v.type === 'dns-address' && host) {
      const addresses = values(v.addresses).length ? values(v.addresses) : values(v.ips).length ? values(v.ips) : text(v.ip) ? [text(v.ip)!] : [];
      for (const address of addresses) dnsRecords.push({host,recordType:text(v.recordType),value:address,relationship:relationship(host),refs});
      fact = `${host} · DNS ${text(v.recordType) ?? 'record type not recorded'} · ${addresses.join(', ') || 'value not recorded'}`;
    } else if (v.relationship === 'CNAME' && host && text(v.origin)) {
      dnsRecords.push({host:text(v.origin)!,recordType:'CNAME',value:host,relationship:relationship(host),refs});
      fact = `${text(v.origin)} · CNAME · ${host}`;
    } else if (['hostname','host','domain','subdomain'].includes(artifact.kind) && host) {
      dnsRecords.push({host,recordType:null,value:null,relationship:relationship(host),refs});
    }
    if (artifact.kind === 'tls') {
      const properties: Array<{name:string;value:string}> = [];
      const fields: Array<[string,string[]]> = [['Subject',['subject']],['Issuer',['issuer']],['Valid from',['validFrom','notBefore']],['Valid until',['validTo','notAfter']],['Fingerprint',['fingerprint']],['Protocol',['tlsVersion']],['Cipher',['cipher']],['Certificate validation',['validation']]];
      for (const [name,keys] of fields) {const value=keys.map(k=>text(v[k])).find(Boolean);if(value)properties.push({name,value});}
      const sans=values(v.sans);if(sans.length)properties.push({name:'SANs',value:sans.join(', ')});
      tls.push({host:host??url??'Host not recorded',properties,refs});
      fact = `TLS observation · ${host??url??'host not recorded'} · ${properties.map(p=>`${p.name}: ${p.value}`).join('; ') || 'certificate properties not recorded'}`;
    }
    if (text(v.redirect) || text(v.location)) {
      redirects.push({from:url??text(v.origin),to:(text(v.redirect)??text(v.location))!,refs});
      fact += ` → ${text(v.redirect)??text(v.location)}`;
    }
    if (artifact.kind === 'port' || artifact.kind === 'service') fact = `${host??'Host not recorded'} · port ${typeof v.port==='number'?v.port:'not recorded'} · ${text(v.protocol)??'protocol not recorded'} · ${text(v.service)??text(v.name)??'service not recorded'} · ${text(v.state)??'state not recorded'}`;
    if (url && ['url','endpoint','api-surface','auth-surface'].includes(artifact.kind)) {
      fact = `${text(v.method)??'Method not recorded'} ${url} · ${artifact.verification==='OBSERVED'&&typeof v.statusCode==='number'?String(v.statusCode):'discovered; response not recorded'}`;
      if(text(v.redirect)||text(v.location))fact+=` → ${text(v.redirect)??text(v.location)}`;
      const category=staticCategory(url);
      if(category){const resources=categories.get(category)??new Map<string,string[]>();resources.set(url,[...new Set([...(resources.get(url)??[]),...refs])]);categories.set(category,resources);}
    }
    provenance.push({entity:'ReconArtifact',id:artifact.id??null,scanRunId:scan.id??null,scopeAssetId:scan.scopeAssetId??null,runId:facts.run.id,host:scan.host??'Host not recorded',kind:artifact.kind,fact,verification:artifact.verification??'Not recorded',scopeState:artifact.scopeState??'Not recorded',sources,firstSeenAt:artifact.firstSeenAt??null,lastSeenAt:artifact.lastSeenAt??null});
  }
  for(const scan of facts.scans)for(const step of scan.steps)if(step.id)provenance.push({entity:'ReconPipelineStep',id:step.id,scanRunId:scan.id??null,scopeAssetId:scan.scopeAssetId??null,runId:facts.run.id,host:scan.host??'Not recorded',kind:'execution',fact:`${step.name} · ${step.state}`,verification:'Recorded execution state',scopeState:'Not authorization',sources:['Persisted pipeline step'],firstSeenAt:null,lastSeenAt:null});
  for(const surface of facts.authSurfaces)for(const row of surface.observations??[])provenance.push({entity:'ReconSurfaceObservation',id:row.id,scanRunId:row.scanRunId,scopeAssetId:null,runId:facts.run.id,host:row.contextLabel,kind:'surface-context',fact:`${row.method} ${row.url} · ${row.responseClass}`,verification:'Recorded response class',scopeState:'Not authorization',sources:[row.source],firstSeenAt:row.observedAt,lastSeenAt:row.observedAt});
  return {dnsRecords,tls,redirects,provenance,staticAssets:[...categories].sort(([a],[b])=>a.localeCompare(b)).map(([category,resources])=>({category,count:resources.size,samples:[...resources].sort(([a],[b])=>a.localeCompare(b)).slice(0,5).map(([url,refs])=>({url,refs})),truncated:resources.size>5})),evidenceTruncated:facts.scans.some(s=>s.artifactCount>s.artifacts.length)};
}
