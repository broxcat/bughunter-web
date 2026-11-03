import type { ArtifactKind } from '@/lib/reconArtifacts';
export type ParsedRecon = { kind: ArtifactKind; value: Record<string, unknown>; observed?: boolean; provider?: string };
const text = (v: unknown, max = 500) => typeof v === 'string' ? v.slice(0,max) : '';
export function parsePassive(tool: string, line: string): ParsedRecon[] {
  if (line.length > 16384) return [];
  try {
    if (tool === 'subfinder' && line.startsWith('{')) {
      const r=JSON.parse(line);if(typeof r.host!=='string')return[];const providers=[...new Set([r.source,...(Array.isArray(r.sources)?r.sources:[])].filter((v):v is string=>typeof v==='string'&&v.length>0))].slice(0,40);return providers.length?providers.map(provider=>({kind:'hostname' as const,value:{hostname:r.host},provider:text(provider,60)})):[{kind:'hostname',value:{hostname:r.host}}];
    }
    const value = line.replace(/\x1b\[[0-9;]*m/g,'').trim();
    // Amass 4.2.0 emits graph relations with typed FQDN nodes, rather than
    // the older '-src name' format. Do not infer provider names from edges.
    if(tool==='amass'&&value.includes('(FQDN)'))return [...value.matchAll(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z0-9-]+)\s+\(FQDN\)/gi)].map(m=>({kind:'hostname' as const,value:{hostname:m[1]}}));
    const amass = /^\[([^\]]+)\]\s+([a-z0-9_.-]+)$/i.exec(value);
    if (amass) return [{kind:'hostname',value:{hostname:amass[2]},provider:amass[1]}];
    return /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(value) ? [{kind:'hostname',value:{hostname:value}}] : [];
  } catch { return []; }
}
export function parseHttpx(line: string): ParsedRecon[] {
  try {
    const r = JSON.parse(line), url = text(r.url,4096); if (!url || r.failed) return [];
    const rows: ParsedRecon[] = [{kind:'endpoint',observed:true,value:{ url, method:'GET', statusCode:Number(r.status_code), contentType:text(r.content_type,100), title:text(r.title,160), ...(r.location ? { redirect:text(r.location,2048) } : {}) }}];
    for (const name of Array.isArray(r.tech) ? r.tech.slice(0,20) : []) rows.push({kind:'technology',value:{hostname:new URL(url).hostname,name:text(name).replace(/:[0-9][^ ]*$/,'')}});
    if (r.tls && typeof r.tls === 'object') rows.push({kind:'tls',observed:true,value:{hostname:new URL(url).hostname,type:'tls', ...(typeof r.tls.not_before === 'string' ? {notBefore:r.tls.not_before} : {}), ...(typeof r.tls.not_after === 'string' ? {notAfter:r.tls.not_after} : {}) }});
    return rows;
  } catch { return []; }
}
export function parseFfuf(line: string): ParsedRecon[] {
  try { const r=JSON.parse(line); if(typeof r.url!=='string'||!Number.isInteger(r.status))return[]; return [{kind:'endpoint',observed:true,value:{url:r.url,method:'GET',statusCode:r.status,contentType:text(r['content-type'],100),...(r.redirectlocation?{redirect:text(r.redirectlocation,2048)}:{})}}]; } catch {return[];}
}
export function parseNmap(xml: string, hostname: string): ParsedRecon[] {
  if(xml.length>2*1024*1024 || /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) return [];
  const rows: ParsedRecon[]=[];
  for(const m of xml.matchAll(/<port\s+protocol="(tcp|udp)"\s+portid="(\d+)"[^>]*>([\s\S]*?)<\/port>/g)) {
    const state=/<state\s+state="(open|closed|filtered)"/.exec(m[3])?.[1]; if(!state)continue;
    const service=/<service\s+name="([a-z0-9?/_-]{1,40})"/i.exec(m[3])?.[1];
    rows.push({kind:'port',observed:true,value:{hostname,port:Number(m[2]),protocol:m[1],state}});
    if(service&&state==='open')rows.push({kind:'service',observed:true,value:{hostname,port:Number(m[2]),protocol:m[1],name:service,versionConfirmed:false}});
  }
  return rows;
}
export function parseNuclei(line:string, allowed: readonly string[], templateVersion:string): ParsedRecon[] {
  try { const r=JSON.parse(line),id=text(r['template-id'],100); if(!allowed.includes(id))return[];
    return [{kind:'observation',observed:true,value:{url:text(r['matched-at'],4096),type:'nuclei-recon',templateId:id,templateVersion,tags:(Array.isArray(r.info?.tags)?r.info.tags:[]).filter((v:unknown)=>typeof v==='string').slice(0,20),severity:text(r.info?.severity,20),description:'Read-only Recon template matched; not a confirmed vulnerability.'}}];
  }catch{return[];}
}

/** Pinned Gobuster 3.8.2 expanded, uncoloured dir/DNS output. */
export function parseGobuster(line:string,mode:'dir'|'dns'):ParsedRecon[] {
  if(mode==='dns'){const host=/^([a-z0-9.-]+)(?:\s|$)/i.exec(line)?.[1];return host&&host.includes('.')?[{kind:'hostname',value:{hostname:host},observed:true}]:[];}
  const match=/^(https?:\/\/\S+)\s+\(Status: (\d{3})\)/.exec(line.trim());
  return match?[{kind:'endpoint',value:{url:match[1],method:'GET',statusCode:Number(match[2]),type:'directory-discovery'},observed:true}]:[];
}
