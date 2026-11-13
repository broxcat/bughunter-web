import type { ReportArtifact, ReportFacts, ReportScan } from './reconReportModel';
import { redactObservationText } from './observationSafety';

export type CoverageState = 'REALISE_AVEC_RESULTAT'|'REALISE_SANS_RESULTAT'|'NON_APPLICABLE'|'NON_EXECUTE'|'EXCLU'|'INTERROMPU'|'ECHEC'|'BUDGET_EPUISE'|'INDISPONIBLE';
export type HostScopeState = 'AUTORISE'|'EXCLU'|'DECOUVERT_NON_AUTORISE'|'INCONNU';
export type WorkPriority = 'HAUTE'|'MOYENNE'|'BASSE';
export type EvidenceLink = { id:string; kind:string; observedAt:string|null; source:string; scopeState:string; verification:string };
export type HostService = { id:string; port:number|null; transport:string|null; state:string|null; name:string|null; observedAt:string|null; evidenceRefs:string[] };
export type HostEndpoint = { url:string; method:string|null; status:number|null; observed:boolean; classification:string; context:string|null; evidenceRefs:string[] };
export type HttpOrigin = { id:string; origin:string; entryUrl:string; status:number|null; title:string|null; redirect:string|null; technologies:string[]; endpoints:HostEndpoint[]; evidenceRefs:string[]; observedAt:string|null };
export type HostCoverage = { family:string; state:CoverageState; detail:string; evidenceRefs:string[] };
export type HostReport = {
  id:string; host:string; scope:HostScopeState; discovered:boolean; tested:boolean; responding:boolean; indirectOnly:boolean;
  collection:string; lastObservedAt:string|null; priority:WorkPriority; priorityReason:string;
  services:HostService[]; origins:HttpOrigin[]; dns:Array<{type:string|null;value:string;relationship:string|null;evidenceRefs:string[]}>;
  technologies:string[]; signals:Array<{title:string;detail:string;confidence:string;evidenceRefs:string[]}>;
  coverage:HostCoverage[]; limitations:string[]; evidence:EvidenceLink[];
};
export type HostRelation = { from:string; relation:string; to:string; confidence:string; evidenceRefs:string[] };
export type HostReportSection = {
  formatVersion:'recon-report/5'; reportId:string; generatedAt:string; selection:{mode:'SINGLE_RUN';runIds:string[]};
  counts:{discovered:number;authorized:number;excluded:number;tested:number;responding:number;services:number;origins:number;urls:number;manualLeads:number;partial:boolean};
  hosts:HostReport[]; relations:HostRelation[]; priorities:Array<{priority:WorkPriority;host:string;service:string;title:string;reason:string;evidenceRefs:string[]}>;
  definitions:string[]; limits:{artifactsPerHost:number;truncatedHosts:number;note:string};
};

const safe=(v:unknown)=>typeof v==='string'&&v.trim()?redactObservationText(v.trim()):null;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const ref=(a:ReportArtifact)=>a.id??'';
const hostnameFrom=(value:Record<string,unknown>)=>safe(value.hostname)??safe(value.host)??(()=>{try{return safe(new URL(String(value.url)).hostname);}catch{return null;}})();
const hostId=(host:string)=>'host-'+host.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,72)||'host-unknown';
const authorized=(host:string,patterns:string[])=>patterns.some(raw=>{let p=raw;try{p=new URL(raw).hostname;}catch{/* host pattern */}return p===host||(p.startsWith('*.')&&host.endsWith(p.slice(1)));});
const excluded=(host:string,patterns:string[])=>patterns.some(raw=>{const p=raw.replace(/^https?:\/\//,'').split('/')[0];return p===host||(p.startsWith('*.')&&host.endsWith(p.slice(1)));});
const unique=<T>(rows:T[],key:(row:T)=>string)=>[...new Map(rows.map(row=>[key(row),row])).values()];
const stageState=(state:string,reason:string|null):CoverageState=>{
  if(state==='COMPLETED'||state==='COMPLETED_WITH_FALLBACK')return 'REALISE_AVEC_RESULTAT';
  if(state==='SKIPPED_NOT_APPLICABLE')return 'NON_APPLICABLE';
  if(state.startsWith('SKIPPED'))return 'NON_EXECUTE';
  if(state==='CANCELLED')return 'INTERROMPU';
  if(state==='FAILED')return /budget|quota|limit/i.test(reason??'')?'BUDGET_EPUISE':'ECHEC';
  if(state==='BLOCKED')return /scope|exclu/i.test(reason??'')?'EXCLU':/budget|quota|limit/i.test(reason??'')?'BUDGET_EPUISE':'NON_EXECUTE';
  if(state==='PARTIAL')return 'REALISE_AVEC_RESULTAT';
  return 'INDISPONIBLE';
};
function endpointClass(kind:string,value:Record<string,unknown>,url:string){
  const type=safe(value.type)?.toLowerCase()??'';let path='';try{path=new URL(url).pathname.toLowerCase();}catch{}
  if(path.startsWith('/cdn-cgi/')||/cloudflare|akamai|waf|cdn/.test(type))return 'Infrastructure CDN/WAF';
  if(kind==='auth-surface'||/auth|login|signin|oauth|sso/.test(type+' '+path))return 'Authentification apparente';
  if(kind==='api-surface'||/openapi|swagger|graphql|api-documentation/.test(type))return 'API apparente';
  if(/admin|management|console/.test(type+' '+path))return 'Administration apparente';
  if(/\.(?:js|css|png|jpe?g|svg|woff2?|map)$/.test(path))return 'Ressource statique';
  return kind==='endpoint'?'Fonctionnalité applicative':'Classification indéterminée';
}
function evidence(a:ReportArtifact):EvidenceLink{
  const sources=Array.isArray(a.sources)?a.sources.map(row=>safe(object(row).sourceRef)??safe(object(row).tool)).filter(Boolean):[];
  return{id:ref(a)||'Référence absente',kind:a.kind,observedAt:a.lastSeenAt??a.firstSeenAt??null,source:sources.join('; ')||'Source non consignée',scopeState:a.scopeState??'Inconnu',verification:a.verification??'Non consignée'};
}
function scanForHost(host:string,scans:ReportScan[]){return scans.find(scan=>scan.host===host||(()=>{try{return new URL(scan.host??'').hostname===host;}catch{return false;}})());}

export function buildHostReportSection(facts:ReportFacts,artifactsPerHost=400,generatedAt=new Date().toISOString()):HostReportSection{
  const hostNames=new Set<string>();
  for(const value of facts.authorizedAssets){try{hostNames.add(new URL(value).hostname);}catch{if(value&&!value.startsWith('*.'))hostNames.add(value);}}
  for(const scan of facts.scans){if(scan.host){try{hostNames.add(new URL(scan.host).hostname);}catch{hostNames.add(scan.host);}}for(const a of scan.artifacts){const host=hostnameFrom(object(a.value));if(host)hostNames.add(host);}}
  const relations:HostRelation[]=[];
  const hosts=[...hostNames].sort().map(host=>{
    const scan=scanForHost(host,facts.scans);const all=facts.scans.flatMap(s=>s.artifacts).filter(a=>hostnameFrom(object(a.value))===host||safelyUrlHost(object(a.value).url)===host);
    const ev=unique(all.filter(a=>a.id).map(evidence),e=>e.id);const services:HostService[]=[];const endpoints:HostEndpoint[]=[];const dns:HostReport['dns']=[];const tech=new Set<string>();const signals:HostReport['signals']=[];
    for(const a of all){const v=object(a.value),id=ref(a);const port=typeof v.port==='number'?v.port:null;const protocol=safe(v.protocol);if((a.kind==='port'||a.kind==='service')&&port)services.push({id:`service-${host}-${protocol??'unknown'}-${port}`,port,transport:protocol,state:safe(v.state),name:safe(v.service)??safe(v.name),observedAt:a.lastSeenAt??null,evidenceRefs:id?[id]:[]});
      const url=safe(v.url);if(url)endpoints.push({url,method:safe(v.method),status:typeof v.statusCode==='number'?v.statusCode:null,observed:a.verification==='OBSERVED'&&typeof v.statusCode==='number',classification:endpointClass(a.kind,v,url),context:safe(v.contextLabel)??safe(v.contextMode),evidenceRefs:id?[id]:[]});
      if(a.kind==='technology'){const name=safe(v.name);if(name)tech.add(name+(safe(v.version)?` ${safe(v.version)}`:''));}
      if(a.kind==='observation'&&safe(v.type)==='dns-address')for(const address of Array.isArray(v.addresses)?v.addresses:[])if(safe(address))dns.push({type:null,value:safe(address)!,relationship:null,evidenceRefs:id?[id]:[]});
      if(a.kind==='hostname'&&safe(v.relationship)){const origin=safe(v.origin)??host,target=safe(v.hostname);if(target){dns.push({type:safe(v.relationship)==='CNAME'?'CNAME':null,value:target,relationship:safe(v.relationship),evidenceRefs:id?[id]:[]});relations.push({from:origin,relation:safe(v.relationship)!,to:target,confidence:a.verification??'Non consignée',evidenceRefs:id?[id]:[]});}}
      if(url&&safe(v.redirect)){let to=safe(v.redirect)!;try{to=new URL(to,url).toString();}catch{}relations.push({from:url,relation:'Redirection observée',to,confidence:a.verification??'Non consignée',evidenceRefs:id?[id]:[]});}
      if(safe(v.type)==='nuclei-recon')signals.push({title:`Correspondance ${safe(v.templateId)??'Nuclei'}`,detail:safe(v.description)??'Correspondance de reconnaissance; validation manuelle nécessaire.',confidence:a.verification??'Non consignée',evidenceRefs:id?[id]:[]});
    }
    const origins=[...new Set(endpoints.map(e=>{try{return new URL(e.url).origin;}catch{return null;}}).filter((v):v is string=>Boolean(v)))].sort().map(origin=>{const rows=endpoints.filter(e=>{try{return new URL(e.url).origin===origin;}catch{return false;}});const first=rows.find(e=>e.observed)??rows[0];return{id:`origin-${hostId(origin)}`,origin,entryUrl:first.url,status:first.status,title:safe(all.find(a=>safe(object(a.value).url)===first.url)?.value.title),redirect:safe(all.find(a=>safe(object(a.value).url)===first.url)?.value.redirect),technologies:[...tech].sort(),endpoints:rows.sort((a,b)=>a.url.localeCompare(b.url)),evidenceRefs:unique(rows.flatMap(e=>e.evidenceRefs),x=>x),observedAt:maxDate(all.filter(a=>{try{return new URL(String(object(a.value).url)).origin===origin;}catch{return false;}}).map(a=>a.lastSeenAt))};});
    const coverage:HostCoverage[]=scan?.steps.length?scan.steps.map(s=>({family:s.name,state:stageState(s.state,s.reason),detail:s.reason??(s.state==='COMPLETED'?'Vérification consignée; consulter les observations associées.':s.state),evidenceRefs:s.id?[s.id]:[]})):[{family:'Couverture historique',state:'INDISPONIBLE',detail:'Aucun détail de phase n’est disponible pour cet hôte dans ce run.',evidenceRefs:[]}];
    const tested=Boolean(scan&&scan.steps.some(s=>['COMPLETED','COMPLETED_WITH_FALLBACK','PARTIAL','FAILED','BLOCKED','CANCELLED'].includes(s.state)));const responding=endpoints.some(e=>e.observed);const scope:HostScopeState=excluded(host,facts.program.outOfScope)?'EXCLU':authorized(host,facts.authorizedAssets)?'AUTORISE':all.some(a=>a.scopeState==='OUT_OF_SCOPE')?'EXCLU':hostNames.has(host)?'DECOUVERT_NON_AUTORISE':'INCONNU';
    const interesting=endpoints.filter(e=>/Authentification|API|Administration/.test(e.classification)).length+signals.length;const priority:WorkPriority=scope!=='AUTORISE'?'BASSE':interesting?'HAUTE':services.length||endpoints.length?'MOYENNE':'BASSE';
    const limitations=[...(scope==='EXCLU'?['Hôte exclu: aucune nouvelle action ne doit être engagée.']:scope!=='AUTORISE'?['Découverte sans autorisation supplémentaire; observation indirecte uniquement.']:[]),...coverage.filter(c=>!['REALISE_AVEC_RESULTAT','REALISE_SANS_RESULTAT','NON_APPLICABLE'].includes(c.state)).map(c=>`${c.family}: ${c.detail}`),...(scan&&scan.artifactCount>scan.artifacts.length?[`Inventaire tronqué: ${scan.artifacts.length} artefacts inclus sur ${scan.artifactCount}.`]:[])];
    return{id:hostId(host),host,scope,discovered:all.length>0,tested,responding,indirectOnly:!scan,collection:scan?`${scan.status}${scan.outcome?` / ${scan.outcome}`:''}`:all.length?'Observation indirecte':'Non testé',lastObservedAt:maxDate(all.map(a=>a.lastSeenAt)),priority,priorityReason:scope!=='AUTORISE'?'Autorisation absente ou exclusion consignée.':interesting?`${interesting} surface(s) d’authentification, API, administration ou signal scanner à examiner.`:services.length||endpoints.length?'Surface réseau ou HTTP observée.':'Aucune surface répondante consignée.',services:mergeServices(services),origins,dns:unique(dns,d=>`${d.type}:${d.value}:${d.relationship}`),technologies:[...tech].sort(),signals,coverage,limitations,evidence:ev};
  });
  const priorities=hosts.filter(h=>h.scope==='AUTORISE').flatMap(h=>h.origins.flatMap(o=>o.endpoints.filter(e=>/Authentification|API|Administration/.test(e.classification)).slice(0,3).map(e=>({priority:h.priority,host:h.host,service:o.origin,title:e.classification,reason:`Observation ${e.observed?'directe':'extraite'}: ${e.url}`,evidenceRefs:e.evidenceRefs}))).concat(h.signals.map(s=>({priority:h.priority,host:h.host,service:h.services[0]?.id??'Service non consigné',title:s.title,reason:s.detail,evidenceRefs:s.evidenceRefs})))).sort((a,b)=>priorityRank(a.priority)-priorityRank(b.priority)||a.host.localeCompare(b.host)||a.title.localeCompare(b.title));
  const counts={discovered:hosts.filter(h=>h.discovered).length,authorized:hosts.filter(h=>h.scope==='AUTORISE').length,excluded:hosts.filter(h=>h.scope==='EXCLU').length,tested:hosts.filter(h=>h.tested).length,responding:hosts.filter(h=>h.responding).length,services:hosts.reduce((n,h)=>n+h.services.length,0),origins:hosts.reduce((n,h)=>n+h.origins.length,0),urls:hosts.reduce((n,h)=>n+h.origins.reduce((m,o)=>m+o.endpoints.length,0),0),manualLeads:priorities.length,partial:facts.scans.some(s=>s.artifactCount>s.artifacts.length)};
  return{formatVersion:'recon-report/5',reportId:`recon-${facts.run.id}`,generatedAt,selection:{mode:'SINGLE_RUN',runIds:[facts.run.id]},counts,hosts,relations:unique(relations,r=>`${r.from}:${r.relation}:${r.to}:${r.evidenceRefs.join(',')}`),priorities,definitions:['Découvert: nom présent dans les preuves sélectionnées.','Autorisé: correspond au périmètre capturé du run; une relation DNS ou HTTP ne l’étend jamais.','Testé: au moins une phase a produit un état terminal consigné pour cet hôte.','Répondant: au moins une réponse HTTP avec code a été observée.','Services et origines sont comptés séparément; les catégories peuvent se recouvrir.'],limits:{artifactsPerHost,truncatedHosts:facts.scans.filter(s=>s.artifactCount>s.artifacts.length).length,note:counts.partial?'Les compteurs sont des bornes basses: au moins un inventaire d’hôte a été tronqué.':'Les compteurs couvrent l’inventaire chargé pour ce run.'}};
}
function safelyUrlHost(value:unknown){try{return new URL(String(value)).hostname;}catch{return null;}}
function maxDate(values:Array<string|undefined|null>){const rows=values.filter((v):v is string=>Boolean(v)).sort();return rows.at(-1)??null;}
function priorityRank(p:WorkPriority){return p==='HAUTE'?0:p==='MOYENNE'?1:2;}
function mergeServices(rows:HostService[]){const merged=new Map<string,HostService>();for(const row of rows){const old=merged.get(row.id);merged.set(row.id,old?{...old,state:row.state??old.state,name:row.name??old.name,observedAt:row.observedAt??old.observedAt,evidenceRefs:[...new Set([...old.evidenceRefs,...row.evidenceRefs])]}:row);}return[...merged.values()].sort((a,b)=>(a.port??0)-(b.port??0)||(a.transport??'').localeCompare(b.transport??''));}
