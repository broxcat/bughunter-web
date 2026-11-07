import {isDeepStrictEqual} from 'node:util';
import { reportInput } from './reconReport';
import { createReconReportV3Input, reportV3Categories, validateReconReportV3 } from './reconReportV3';
import type { ReportFacts, ReconReportModel } from './reconReportModel';
import type { SummaryEvidence } from './reconSummary';
import { detectScopeAsset } from './scopeAssets';

export type RunNarrative = { state:'AI_ASSISTED'|'DETERMINISTIC'|'UNAVAILABLE'|'PENDING'; provider?:string;model?:string; highlights:Array<{text:string;refs:string[]}> };
export const deterministicNarrative = ():RunNarrative=>({state:'DETERMINISTIC',highlights:[]});
/** No provider inspection/inference: reconstruct the existing v3 validation
 * contract from this exact run's bounded, captured evidence only. */
export function runNarrativeInput(facts:ReportFacts) {
  const evidence:SummaryEvidence[]=[];
  // Reuse v3's 1,000-row validation bound; larger reports remain deterministic.
  for(const scan of facts.scans)for(const a of scan.artifacts){if(evidence.length>=1000)break;if(a.id)evidence.push({id:a.id,kind:a.kind,value:a.value,verification:a.verification,scopeState:a.scopeState,sources:a.sources});}
  for(const scan of facts.scans) {
    const id=scan.scopeAssetId,boundary=scan.host;
    if(id&&boundary){try{evidence.push({id,kind:'asset',value:{normalized:boundary,format:detectScopeAsset(boundary).format,active:true}});}catch{/* Invalid historical boundary cannot authorize a narrative. */}}
  }
  return createReconReportV3Input(reportInput({source:'target',target:facts.program.companyName,reconStatus:facts.run.outcome??facts.run.status,exclusions:facts.program.outOfScope,authorization:'Captured boundaries only; revalidate current Scope before new work.'},evidence),evidence);
}
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Existing free-form v3 prose is revalidated, then ONLY its evidence selection
 * is consumed. Application-written fact descriptions supply every rendered
 * assertion. This prevents an unrecognized semantic claim bypassing a prose
 * detector (tools, services, personas, commands, policy or safety conclusions).
 * No arbitrary model text/HTML becomes part of the run report or export.
 */
export function projectRunNarrative(content:unknown,facts:ReportFacts,model:ReconReportModel):RunNarrative {
  const report=object(content);
  if(report.version!==3||!['VALID','RECOVERED'].includes(String(report.narrativeStatus)))return {state:'UNAVAILABLE',highlights:[]};
  const input=runNarrativeInput(facts),n=object(report.narrative),inverse=new Map(Object.entries(input.aliases).map(([alias,id])=>[id,alias]));
  const entries=(v:unknown,keys:string[])=>Array.isArray(v)?v.map(candidate=>{const e=object(candidate);return Object.fromEntries(keys.map(k=>[k,k==='evidenceRefs'&&Array.isArray(e[k])?e[k].map(id=>{if(typeof id!=='string'||!inverse.has(id))throw new Error('Unknown persisted evidence reference');return inverse.get(id);}):e[k]]));}):[];
  const payload={title:n.title,attackSurfaceSummary:n.attackSurfaceSummary,sections:reportV3Categories.map(category=>({category,entries:entries(n[category],['text','confidence','evidenceRefs'])})),notableObservations:entries(n.notableObservations,['title','observation','relevance','confidence','evidenceRefs']),limitations:n.limitations,researchHandoff:entries(n.researchHandoff,['priority','area','rationale','evidenceRefs'])};
  const text=JSON.stringify(payload);
  // Conservative additional rejection before a citation-only projection.
  if(/\b(?:safe|secure|removed|completed successfully|no vulnerabilities|vulnerability found|confirmed vulnerability|exploit confirmed)\b/i.test(text))throw new Error('Unsupported conclusion');
  const tools=new Set(model.tools.map(t=>t.name.toLowerCase()));
  for(const m of text.matchAll(/\b(?:tool|provider|executed|ran)\s+([a-z][a-z0-9_-]*)\b/gi))if(!tools.has(m[1].toLowerCase()))throw new Error('Unsupported tool');
  const services=new Set(model.network.flatMap(n=>n.service?[n.service.toLowerCase()]:[]));
  for(const m of text.matchAll(/\bservice\s*(?:is|:|=)?\s*([a-z][a-z0-9_-]*)\b/gi))if(!services.has(m[1].toLowerCase()))throw new Error('Unsupported service');
  const contexts=new Set(model.authenticated.contexts.map(c=>c.label.toLowerCase()));
  for(const m of text.matchAll(/\b(?:persona|session context|authentication context)\s*[:=]?\s*([a-z][a-z0-9_-]*)\b/gi))if(!contexts.has(m[1].toLowerCase()))throw new Error('Unsupported persona');
  const accepted=validateReconReportV3(JSON.stringify(payload),input);
  const selected=[...accepted.narrative.notableObservations,...accepted.narrative.researchHandoff,...reportV3Categories.flatMap(k=>accepted.narrative[k])].flatMap(e=>e.evidenceRefs);
  const previous=object(report.factual).sections;
  const previousRows=Array.isArray(previous)?previous.flatMap(s=>{const rows=object(s).rows;return Array.isArray(rows)?rows:[];}):[];
  const currentRows=input.factual.sections.flatMap(s=>s.rows);
  const highlights:RunNarrative['highlights']=[];
  for(const id of [...new Set(selected)].slice(0,8)) {
    const fact=model.provenance.find(p=>p.id===id),fresh=currentRows.find(r=>r.evidenceRefs.includes(id));
    const old=previousRows.find(r=>{const refs=object(r).evidenceRefs;return Array.isArray(refs)&&refs.includes(id);});
    if(!fact||!fresh)continue; // No invented citation for legacy/coverage-only data.
    if(!old||!isDeepStrictEqual(object(old).details,fresh.details)||object(old).value!==fresh.value||object(old).scopeState!==fresh.scopeState)throw new Error('Stale evidence');
    highlights.push({text:fact.fact,refs:[id]});
  }
  if(!highlights.length)return {state:'UNAVAILABLE',highlights:[]};
  return {state:'AI_ASSISTED',highlights};
}
