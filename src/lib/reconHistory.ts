import {createHash} from 'node:crypto';
import {safeSurfaceUrl} from './authenticatedRecon';
import {redactEvidenceText} from './evidenceVault';
import {classifyReconUrl} from './reconArtifacts';
export type HistorySurface={kind:string;identity:string;label:string;details:Record<string,unknown>;sourceRefs:string[];firstSeenAt:string;lastSeenAt:string;staticAsset:boolean};
export type HistoryRow=HistorySurface&{id:string;fingerprint:string;observedRuns:number};
export const historyHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const historyText=(s:unknown)=>redactEvidenceText(String(s??'')).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500);
const fields=['hostname','addresses','address','port','protocol','service','name','type','statusCode','contentType','method','declaredMethod','fingerprint','issuer','subject','notAfter','valid','responseClass','scopeState','verification'] as const;
/** An allowlist deliberately excludes response bodies, credentials and volatile timing. */
export function historySurface(kind:string,value:Record<string,unknown>,firstSeenAt:string,lastSeenAt:string,sourceRefs:string[]=[]):HistorySurface|null{
 const details:Record<string,unknown>={};
 for(const field of fields){const v=value[field];if(typeof v==='string')details[field]=historyText(v);else if(typeof v==='number'||typeof v==='boolean')details[field]=v;else if(Array.isArray(v))details[field]=[...new Set(v.filter(s=>typeof s==='string').map(historyText))].sort();}
 try{if(typeof value.url==='string')details.url=safeSurfaceUrl(value.url);for(const field of ['redirect','location','redirectTarget'])if(typeof value[field]==='string')details.redirect=safeSurfaceUrl(new URL(value[field],String(details.url)).href);}catch{return null;}
 const base=String(details.url??details.hostname??'');if(!base)return null;
 const discriminator=kind==='port'||kind==='service'?`${details.port}/${details.protocol??'tcp'}`:kind==='technology'?details.name:kind==='parameter'?details.name:kind==='observation'?details.type:undefined;
 const identity=JSON.stringify([kind,base,details.method??details.declaredMethod??null,discriminator??null]);
 return{kind,identity,label:[details.method,base,discriminator].filter(Boolean).join(' · '),details,sourceRefs,firstSeenAt,lastSeenAt,staticAsset:typeof details.url==='string'&&classifyReconUrl(details.url)==='static'};
}
export function compareHistory(current:HistoryRow[],previous:HistoryRow[]){
 const a=new Map(current.map(r=>[r.id,r])),b=new Map(previous.map(r=>[r.id,r]));
 return{new:current.filter(r=>!b.has(r.id)),changed:current.filter(r=>b.has(r.id)&&b.get(r.id)!.fingerprint!==r.fingerprint),notObserved:previous.filter(r=>!a.has(r.id)),unchanged:current.filter(r=>b.get(r.id)?.fingerprint===r.fingerprint)};
}
