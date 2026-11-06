// Explicit local acceptance: read an existing Recon export, no scanner or DB writes.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {BrainClient} from '@/server/brain/client';
import {inspectOllamaReportModel} from '@/server/recon/ollamaReport';
import {generateReconReportV3} from '@/server/recon/ollamaReportV3';
import type {ReconReportV3Input} from '@/lib/reconReportV3';
assert.equal(process.env.RECON_LOCAL_ACCEPTANCE,'1');
const source=JSON.parse(await readFile('/acceptance/source.json','utf8'));
const model='gpt-oss:20b',baseUrl=source.config.baseUrl;
const tags=await fetch(baseUrl+'/api/tags').then(r=>r.json());
assert(tags.models.some((m:{name:string})=>m.name===model),'Requested local model is unavailable');
const input:ReconReportV3Input=source.job.input;
input.budget=await inspectOllamaReportModel(baseUrl,model);
input.assessmentContext={assessmentMode:'BLACK_BOX',authorizedSourceCount:0,sourceContentAvailable:false,sourceAnalysisPerformed:false,networkAuthorizationSource:'ScopeAsset',sourceAuthorizationSeparate:true};
const client=new BrainClient({provider:'OLLAMA',model,baseUrl});
const nativeFetch=globalThis.fetch,statuses:number[]=[];globalThis.fetch=async(input,init)=>{const result=await nativeFetch(input,init);if(String(input).endsWith('/api/chat'))statuses.push(result.status);return result;};
const started=Date.now();let report;try{report=await generateReconReportV3(client,input,{timeoutMs:180000});}finally{globalThis.fetch=nativeFetch;}
const refs:string[]=[];
function collect(value:unknown){if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(key==='evidenceRefs'&&Array.isArray(item))refs.push(...item);else collect(item);}}
collect(report.narrative);
await writeFile('/acceptance/ollama-report.json',JSON.stringify({input,report}),{mode:0o600});
console.log(JSON.stringify({provider:'OLLAMA',model,prompt:'recon-report/3',httpStatuses:statuses,narrativeStatus:report.narrativeStatus,citations:refs.length,uniqueEvidenceReferences:new Set(refs).size,durationMs:Date.now()-started,generation:report.generation}));
assert(['VALID','RECOVERED'].includes(report.narrativeStatus),'A factual-only report is not acceptance');
