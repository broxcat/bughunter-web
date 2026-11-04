import { AUTH_DIFFERENTIAL_NOTICE, deriveSurfaceVisibility, safeSurfaceUrl, type SafeAuthSurface, type SafeAuthContext, type SurfaceObservation } from '@/lib/authenticatedRecon';
import type { SummaryEvidence } from '@/lib/reconSummary';

const roles=new Set(['ADMIN','ADMINISTRATOR','MANAGER','USER','STANDARD_USER','CUSTOMER','VENDOR','TENANT_A','TENANT_B','READ_ONLY','READONLY','EDITOR','OWNER','STAFF','SUPPORT','SERVICE','GUEST','ACCOUNT_A','ACCOUNT_B']);
const purposes=new Set(['ACCOUNT_A','ACCOUNT_B','SESSION_COOKIE','JWT','OTHER']);
const token=(value:unknown,fallback='UNKNOWN')=>typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)?value:fallback;
const ref=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value)?value:undefined;
const stamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;
export const AUTH_EXPORT_BYTES=96*1024;
/** Independent export projection: no credential record, account label, raw
 * response, hash, length, login name, identity proof or cipher can pass through.
 * Public labels are opaque; personas remain explicitly operator-declared. */
export function exportAuthSurfaces(input:SafeAuthSurface[]):SafeAuthSurface[]{
  const ordered=[...input].sort((a,b)=>{
    const seen=(surface:SafeAuthSurface)=>Math.max(0,...surface.observations.map(row=>Date.parse(row.observedAt)||0));
    return seen(b)-seen(a)||a.scanRunId.localeCompare(b.scanRunId);
  });
  const result=ordered.slice(0,20).map((surface):SafeAuthSurface=>{
    const scanRunId=ref(surface.scanRunId)??'unknown-run';
    if(surface.legacy)return{scanRunId,legacy:true,contexts:[],observations:[],surfaceVisibility:[],totals:{public:0,authenticatedOnly:0,sharedAuthenticated:0,contextDifferentials:0,observations:0},warnings:['Historical run: authentication context was not captured. Missing context is unknown, not anonymous.'],...(surface.truncated?{truncated:true}:{})};
    let number=0;
    const contextOrder=[...surface.contexts].sort((a,b)=>{const score=(context:SafeAuthContext)=>context.mode==='ANONYMOUS'?-1:surface.observations.some(row=>row.contextKey===context.contextKey&&row.responseClass!=='UNAVAILABLE')?0:context.state==='PLANNED'?1:2;return score(a)-score(b)||a.contextKey.localeCompare(b.contextKey);});
    const contexts:SafeAuthContext[]=contextOrder.slice(0,5).flatMap(context=>{
      if(!ref(context.contextKey))return[];
      const persona=typeof context.persona==='string'?context.persona.trim().toUpperCase().replace(/[ -]+/g,'_'):'';
      return[{contextKey:context.contextKey,mode:context.mode==='ANONYMOUS'?'ANONYMOUS':'AUTHENTICATED',label:context.mode==='ANONYMOUS'?'Anonymous':`Authenticated context ${++number}`,state:token(context.state),...(purposes.has(context.purpose??'')?{purpose:context.purpose}:{}),persona:roles.has(persona)?persona:context.persona?'Operator-declared persona (label withheld)':null,...(context.reason?{reason:token(context.reason,'COVERAGE_UNAVAILABLE')}:{}),...(stamp(context.checkedAt)?{checkedAt:stamp(context.checkedAt)}:{})}];
    });
    const keys=new Map(contexts.map(context=>[context.contextKey,context]));
    const all:SurfaceObservation[]=surface.observations.flatMap(row=>{
      const context=keys.get(row.contextKey);if(!context||!stamp(row.observedAt)||!['GET','HEAD'].includes(row.method))return[];
      try{
        const url=safeSurfaceUrl(row.url),statusCode=typeof row.statusCode==='number'&&Number.isInteger(row.statusCode)&&row.statusCode>=100&&row.statusCode<=599?row.statusCode:null;
        return[{...(ref(row.id)?{id:ref(row.id)}:{}),contextKey:context.contextKey,contextType:context.mode,canonicalKey:/^(?:GET|HEAD):[a-f0-9]{64}$/.test(row.canonicalKey)?row.canonicalKey:`${row.method}:uncomparable:${ref(row.id)??'unknown'}`,url,urlRedacted:row.urlRedacted===true||url!==row.url,method:row.method,statusCode,contentType:typeof row.contentType==='string'&&/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;\s*charset=[a-z0-9_-]+)?$/i.test(row.contentType)?row.contentType:null,redirect:null,redirectPattern:null,responseClass:['CONTENT','DENIED','LOGIN_REDIRECT','UNAVAILABLE'].includes(row.responseClass)?row.responseClass:'UNAVAILABLE',observedAt:stamp(row.observedAt)!,source:'context-http'}];
      }catch{return[];}
    }).sort((a,b)=>a.canonicalKey.localeCompare(b.canonicalKey)||a.contextKey.localeCompare(b.contextKey)||(a.id??'').localeCompare(b.id??''));
    const visibility=deriveSurfaceVisibility(contexts,all),selected=visibility.slice(0,30),selectedRefs=new Set(selected.flatMap(row=>row.evidenceRefs));
    const observations=all.filter(row=>row.id&&selectedRefs.has(row.id)).slice(0,160);
    const has=(classification:'PUBLIC'|'AUTHENTICATED_ONLY'|'SHARED_AUTHENTICATED'|'CONTEXT_DIFFERENTIAL')=>visibility.filter(row=>row.classifications.includes(classification)).length;
    const truncated=Boolean(surface.truncated||contexts.length<surface.contexts.length||selected.length<visibility.length||observations.length<all.length);
    return{scanRunId,legacy:false,contexts,observations,surfaceVisibility:selected,totals:{public:has('PUBLIC'),authenticatedOnly:has('AUTHENTICATED_ONLY'),sharedAuthenticated:has('SHARED_AUTHENTICATED'),contextDifferentials:has('CONTEXT_DIFFERENTIAL'),observations:all.length},warnings:[AUTH_DIFFERENTIAL_NOTICE,'Context URLs are sanitized evidence identities. Redacted placeholders must never be reconstructed or used as request targets.',...(truncated?['Context export is bounded. Original structured Recon observations and context coverage remain available.']:[])],...(truncated?{truncated:true}:{})};
  });
  while(Buffer.byteLength(JSON.stringify(result))>AUTH_EXPORT_BYTES-512){
    const biggest=[...result].sort((a,b)=>JSON.stringify(b).length-JSON.stringify(a).length)[0];
    if(biggest.observations.length)biggest.observations.splice(-Math.max(1,Math.ceil(biggest.observations.length/3)));else if(biggest.surfaceVisibility.length)biggest.surfaceVisibility.splice(-Math.max(1,Math.ceil(biggest.surfaceVisibility.length/3)));else{result.pop();continue;}
    biggest.truncated=true;
    if(!biggest.warnings.includes('Context export size limit reached; inspect original Recon observations for details.'))biggest.warnings.push('Context export size limit reached; inspect original Recon observations for details.');
  }
  if(ordered.length>result.length&&result.length)result[0].warnings.push('Retained context-run limit reached; earlier runs remain in Recon history.');
  return result;
}

/** Adds real, contextual HTTP evidence to the existing alias/fact pipeline.
 * A denied or unavailable observation never becomes a confirmed access result. */
export function authSurfaceEvidence(surfaces:SafeAuthSurface[]):SummaryEvidence[]{
  return surfaces.flatMap(surface=>surface.observations.flatMap(row=>{
    if(!row.id)return[];const context=surface.contexts.find(item=>item.contextKey===row.contextKey);if(!context)return[];
    return[{id:row.id,kind:'endpoint',verification:row.responseClass==='UNAVAILABLE'?'DISCOVERED':'OBSERVED',value:{url:row.url,method:row.method,...(row.statusCode?{statusCode:row.statusCode}:{}),...(row.contentType?{contentType:row.contentType}:{}),type:'context-surface',contextKey:context.contextKey,contextMode:context.mode,contextLabel:context.label,persona:context.persona??'Not captured',responseClass:row.responseClass,safeForActiveReview:row.urlRedacted!==true&&!/%5b(?:redacted|id)%5d|\[(?:redacted|id)\]/i.test(row.url)},sources:[{tool:'context-http',sourceRef:'ReconSurfaceObservation:'+row.id,observedAt:row.observedAt}]}];
  }));
}
