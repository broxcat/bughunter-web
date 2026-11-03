import { createHash } from 'node:crypto';
import { Prisma,type ReconArtifact } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { BrainClient,BrainError } from '../brain/client';
import { SUMMARY_PROMPT_VERSION,SUMMARY_SYSTEM,summaryInput,reconSummarySchema,validateReconSummary,type SummaryEvidence } from '@/lib/reconSummary';
import { ResearchError } from '../research/workspace';
import { z } from 'zod';
import { reportInput,compactPriorReconReport,ReconReportValidationError,type ReportBudget,type ReconReportInput } from '@/lib/reconReport';
import { assetAllowsHost,assetAllowsUrl,type AssetBoundary } from '@/lib/scopeAssets';
import { isExcluded } from '@/lib/bountyProgram';
import { inspectOllamaReportModel,generateReconReport } from './ollamaReport';
const terminal=['COMPLETED','FAILED'];
const staticPattern=String.raw`/_next/static/|\.(js|mjs|css|map|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)(/|$)`;
const asJson=(v:unknown)=>v as Prisma.InputJsonValue;
function currentEvidenceScope(asset:AssetBoundary,value:unknown,exclusions:string[]):'IN_SCOPE'|'OUT_OF_SCOPE'{
  try{
    const data=value&&typeof value==='object'?value as Record<string,unknown>:{};
    const url=typeof data.url==='string'?data.url:undefined,host=url?new URL(url).hostname:typeof data.hostname==='string'?data.hostname:typeof data.host==='string'?data.host:'';
    return asset.active!==false&&!isExcluded(host,exclusions)&&(url?assetAllowsUrl(asset,url):assetAllowsHost(asset,host))?'IN_SCOPE':'OUT_OF_SCOPE';
  }catch{return'OUT_OF_SCOPE';}
}
export async function ollamaSummaryConfig(userId:string){
  const config=await prisma.aiProviderConfig.findUnique({where:{userId_provider:{userId,provider:'OLLAMA'}}});
  if(!config?.baseUrl?.trim()||!config.model?.trim())return null;
  const url=new URL(config.baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return null;
  return {endpoint:config.baseUrl.replace(/\/+$/,''),model:config.model};
}
type AuthorizationDb=Pick<Prisma.TransactionClient,'bountyProgram'|'scopeAsset'>;
function authorizationHash(program:{outOfScope:string[];rulesOfEngagement:string|null;requiredUserAgent:string;updatedAt:Date},assets:{id:string;format:string;normalizedValue:string;updatedAt:Date;executionTarget?:{scope:{id:string;status:string;updatedAt:Date}}|null}[]){return createHash('sha256').update(JSON.stringify({exclusions:[...program.outOfScope].sort(),rulesOfEngagement:program.rulesOfEngagement,userAgent:program.requiredUserAgent,policyRevision:program.updatedAt,assets:[...assets].sort((a,b)=>a.id.localeCompare(b.id)).map(a=>({id:a.id,format:a.format,boundary:a.normalizedValue,revision:a.updatedAt,executionScope:a.executionTarget?.scope??null}))})).digest('hex');}
async function currentAuthorizationFingerprint(db:AuthorizationDb,userId:string,programId:string){
  const program=await db.bountyProgram.findFirst({where:{id:programId,ownerId:userId,deletingAt:null},select:{outOfScope:true,rulesOfEngagement:true,requiredUserAgent:true,updatedAt:true}});if(!program)return null;
  const assets=await db.scopeAsset.findMany({where:{programId,active:true},select:{id:true,format:true,normalizedValue:true,updatedAt:true,executionTarget:{select:{scope:{select:{id:true,status:true,updatedAt:true}}}}},orderBy:{id:'asc'},take:1000});return authorizationHash(program,assets);
}
async function lockExecutionScopes(tx:Prisma.TransactionClient,programId:string){
  await tx.$queryRaw`SELECT id FROM "Scope" WHERE id IN (SELECT t."scopeId" FROM "Target" t JOIN "ScopeAsset" a ON a.id=t."scopeAssetId" WHERE t."programId"=${programId} AND a.active=true) ORDER BY id FOR SHARE`;
}
export async function buildSummaryInput(userId:string,programId:string,assetId?:string,budget?:ReportBudget) {
  // Capture one coherent authorization before potentially lengthy compaction.
  // Normal scope mutations take this same Program row exclusively.
  const captured=await prisma.$transaction(async tx=>{
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} AND "deletingAt" IS NULL FOR SHARE`;
    if(!rows.length)throw new ResearchError('Target unavailable',404);
    await lockExecutionScopes(tx,programId);
    const program=await tx.bountyProgram.findUniqueOrThrow({where:{id:programId}});
    const assets=await tx.scopeAsset.findMany({where:{programId,active:true},orderBy:[{assetValue:'asc'},{id:'asc'}],take:1000,include:{executionTarget:{select:{scope:{select:{id:true,status:true,updatedAt:true}}}}}});return{program,assets,fingerprint:authorizationHash(program,assets)};
  });
  const program=captured.program;
  const parent=assetId?null:await prisma.targetReconRun.findFirst({where:{programId,status:{in:['COMPLETED','FAILED']}},orderBy:[{createdAt:'desc'},{id:'desc'}],include:{scans:{select:{scopeAssetId:true}}}});
  if(!assetId&&!parent)throw new ResearchError('No finished Target Recon',409);
  const assets=captured.assets.filter(a=>assetId?a.id===assetId:parent!.scans.some(s=>s.scopeAssetId===a.id));
  if(!assets.length)throw new ResearchError('No active Scope Assets',409);
  const runs=await prisma.scanRun.findMany({where:{scopeAssetId:{in:assets.map(a=>a.id)},status:{in:['COMPLETED','FAILED']},...(parent?{targetReconRunId:parent.id}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:assetId?1:1000,include:{reconSteps:{orderBy:{position:'asc'}},_count:{select:{artifacts:true}}}});
  if(!runs.length||(!assetId&&runs.length!==assets.length))throw new ResearchError('Recon has not reached a terminal state',409);
  const staticRows=await prisma.$queryRaw<{scanRunId:string;count:number}[]>(Prisma.sql`SELECT "scanRunId",count(*)::int AS count FROM "ReconArtifact" WHERE "scanRunId" IN (${Prisma.join(runs.map(r=>r.id))}) AND kind IN ('endpoint','url') AND split_part(split_part(COALESCE(value->>'url',''), '?', 1), '#', 1) ~* ${staticPattern} GROUP BY "scanRunId"`);
  const staticCounts=new Map(staticRows.map(r=>[r.scanRunId,r.count]));
  const evidence:SummaryEvidence[]=[];
  for(const run of runs){
    const asset=assets.find(a=>a.id===run.scopeAssetId)!;
    const boundary={...asset,active:asset.active&&asset.executionTarget?.scope.status==='APPROVED'};
    const artifactEvidence=(r:ReconArtifact):SummaryEvidence=>({id:r.id,kind:r.kind,value:r.value,scopeState:currentEvidenceScope(boundary,r.value,program.outOfScope),verification:r.verification,sources:r.sources});
    evidence.push({id:asset.id,kind:'asset',value:{original:asset.originalValue,normalized:asset.normalizedValue,format:asset.format,formatSource:asset.formatSource,type:asset.type,value:asset.assetValue,active:asset.active&&asset.executionTarget?.scope.status==='APPROVED',authorizationState:asset.executionTarget?.scope.status??'UNKNOWN',recon:run.status,outcome:run.outcome,runId:run.id,artifactCount:run._count.artifacts,capturedPlan:run.reconPlan ? (()=>{const plan=run.reconPlan as Record<string,unknown>;return{format:plan.format,type:plan.type,depth:plan.depth,activityMode:plan.activityMode,boundary:plan.boundary,...(assetId?{rationale:plan.rationale}:{})};})() : null}});
    for(const step of run.reconSteps){const extended=step as unknown as {capability?:string;details?:unknown};const plan=run.reconPlan as {stages?:{name:string;tools?:string[]}[]}|null;evidence.push({id:step.id,kind:'coverage',value:{assetId:asset.id,name:step.name,state:step.state,reason:step.reason,capability:extended.capability,details:extended.details,tools:plan?.stages?.find(s=>s.name===step.name)?.tools??[]}});}
    if(run.changeSet){
      const changes=run.changeSet as unknown as Record<string,unknown>;
      const {assetGraph,...diff}=changes;
      evidence.push({id:`changes:${run.id}`,kind:'change',value:diff});
      const graph=assetGraph as {nodes?:{id:string;type:string;value:string;inScope:boolean;evidenceRefs:string[]}[];edges?:{id:string;from:string;to:string;relation:string;evidenceRefs:string[];verification:string}[];truncated?:boolean}|undefined;
      if(graph?.nodes&&graph.edges){
        const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
        for(const edge of graph.edges.slice(0,150)){const from=nodes.get(edge.from),to=nodes.get(edge.to);if(from&&to){const state=(value:string)=>currentEvidenceScope(boundary,/^https?:\/\//.test(value)?{url:value}:{hostname:value},program.outOfScope);evidence.push({id:'relation:'+createHash('sha256').update(edge.id).digest('hex'),kind:'relation',sources:[{sourceRef:'ScanRun:'+run.id+':assetGraph',evidenceRefs:edge.evidenceRefs}],scopeState:state(from.value)==='IN_SCOPE'&&state(to.value)==='IN_SCOPE'?'IN_SCOPE':'OUT_OF_SCOPE',verification:edge.verification,value:{graphRelationId:edge.id,from:from.value,fromType:from.type,to:to.value,toType:to.type,relationship:edge.relation,evidenceRefs:edge.evidenceRefs,authorizationGranted:false}});}}
      }
    }
    if(assetId){
      const principal=await prisma.reconArtifact.findMany({where:{scanRunId:run.id,kind:{notIn:['endpoint','url']}},orderBy:[{kind:'asc'},{canonicalKey:'asc'}],take:500});
      // Match path extensions, not substrings: .json is API evidence, not .js.
      const dynamic=await prisma.$queryRaw<ReconArtifact[]>`SELECT * FROM "ReconArtifact" WHERE "scanRunId"=${run.id} AND kind IN ('endpoint','url') AND split_part(split_part(COALESCE(value->>'url',''), '?', 1), '#', 1) !~* ${staticPattern} ORDER BY "canonicalKey",id LIMIT 1000`;
      const staticCount=staticCounts.get(run.id)??0;
      evidence.push(...[...principal,...dynamic].map(artifactEvidence));
      const counts=await prisma.reconArtifact.groupBy({by:['kind'],where:{scanRunId:run.id},_count:true});evidence.push({id:`inventory:${run.id}`,kind:'coverage',value:{counts,sampledRecords:principal.length+dynamic.length,artifactCount:run._count.artifacts,staticAssetCount:staticCount,staticAssets:'Summarized in scope.md; excluded from individual summary evidence.'}});
    }
    else {
      evidence.push({id:`inventory:${run.id}`,kind:'coverage',value:{artifactCount:run._count.artifacts,staticAssetCount:staticCounts.get(run.id)??0,staticAssets:'Static paths omitted; full factual inventory remains in scope.md and artifacts.'}});
      // Target synthesis consumes compact structured child summaries, not raw logs.
      const summary=await prisma.reconSummary.findFirst({where:{scanRunId:run.id,status:'READY'},orderBy:{createdAt:'desc'}});
      if(summary){
        const brief=compactPriorReconReport(summary.content);
        evidence.push({id:summary.id,kind:'summary',sources:[{sourceRef:'ReconSummary:'+summary.id,promptVersion:summary.promptVersion,sourceFingerprint:summary.sourceFingerprint}],value:{assetId:asset.id,llmGenerated:true,authoritative:false,model:summary.model,promptVersion:summary.promptVersion,generatedAt:summary.generatedAt?.toISOString(),narrative:brief.narrative}});
        if(brief.referencedIds.length){
          const originals=await prisma.reconArtifact.findMany({where:{scanRunId:run.id,scopeState:'IN_SCOPE',id:{in:brief.referencedIds}},orderBy:{id:'asc'},take:80});
          evidence.push(...originals.map(artifactEvidence));
        }
      }
      const rows=await prisma.reconArtifact.findMany({where:{scanRunId:run.id,scopeState:'IN_SCOPE',kind:{in:['hostname','port','service','technology','api-surface','auth-surface','relation','tls','observation']}},orderBy:[{kind:'asc'},{canonicalKey:'asc'}],take:100});
      evidence.push(...rows.map(artifactEvidence));
    }
  }
  if(!runs.some(r=>r._count.artifacts>0))throw new ResearchError('No usable Recon evidence yet',409);
  if(await currentAuthorizationFingerprint(prisma,userId,programId)!==captured.fingerprint)throw new ResearchError('Scope changed while preparing the report; regenerate from current authorization',409);
  const input=reportInput({sourceAuthorizationFingerprint:captured.fingerprint,untestedCurrentAssets:captured.assets.length-assets.length,rulesOfEngagement:program.rulesOfEngagement,assetCount:assets.length,reconStatus:parent?.outcome??parent?.status,runCount:runs.length,testedAt:runs.map(r=>r.finishedAt?.toISOString()).filter(Boolean).sort().at(-1)??'Not recorded',targetId:programId,target:program.companyName,exclusions:program.outOfScope,authorization:'Only explicit active Scope Assets; discoveries never grant authorization.',source:assetId?'asset':'target',runIds:runs.map(r=>r.id),targetReconRunId:parent?.id,coverageNote:'Input is bounded; omitted evidence remains in artifacts and scope.md.'},evidence,budget);
  return{input,scanRunId:assetId?runs[0].id:undefined,targetReconRunId:parent?.id,scopeAssetId:assetId};
}
export async function scheduleReconSummary(userId:string,programId:string,assetId?:string,regenerate=false){
  const config=await ollamaSummaryConfig(userId);if(!config)throw new ResearchError('Configure an Ollama endpoint and model in Settings',409);
  const budget=await inspectOllamaReportModel(config.endpoint,config.model);
  let source;try{source=await buildSummaryInput(userId,programId,assetId,budget);}catch(error){if(error instanceof Error&&error.message.includes('selected model budget'))throw new ResearchError('Selected Ollama context cannot fit the minimum authorization and coverage; scope.md remains available',422);throw error;}
  const fingerprint=createHash('sha256').update(JSON.stringify(source.input)).digest('hex');
  const key=createHash('sha256').update(JSON.stringify([source.scanRunId??source.targetReconRunId,config,SUMMARY_PROMPT_VERSION,fingerprint])).digest('hex');
  const data={programId,scopeAssetId:assetId,scanRunId:source.scanRunId,targetReconRunId:source.targetReconRunId,model:config.model,endpoint:config.endpoint,promptVersion:SUMMARY_PROMPT_VERSION,sourceFingerprint:fingerprint,input:asJson(source.input)};
  // The FK and committed program tombstone prevent publication after deletion.
  return prisma.$transaction(async tx=>{
    const allowed=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} AND "deletingAt" IS NULL FOR SHARE`;
    if(!allowed.length)throw new ResearchError('Target unavailable',404);
    if(assetId&&!((await tx.$queryRaw<{id:string}[]>`SELECT id FROM "ScopeAsset" WHERE id=${assetId} AND "programId"=${programId} AND active=true FOR SHARE`).length))throw new ResearchError('Scope Asset unavailable',404);
    return regenerate?tx.reconSummary.create({data}):tx.reconSummary.upsert({where:{automaticKey:key},create:{...data,automaticKey:key},update:{}});
  });
}
export async function summaryView(userId:string,programId:string,assetId?:string){
  if(!await prisma.bountyProgram.count({where:{id:programId,ownerId:userId,deletingAt:null}}))throw new ResearchError('Target unavailable',404);
  if(assetId&&!await prisma.scopeAsset.count({where:{id:assetId,programId}}))throw new ResearchError('Scope unavailable',404);
  const row=await prisma.reconSummary.findFirst({where:{programId,...(assetId?{scopeAssetId:assetId}:{scopeAssetId:null})},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,status:true,model:true,promptVersion:true,sourceFingerprint:true,scanRunId:true,targetReconRunId:true,createdAt:true,generatedAt:true,content:true,error:true,input:true}});
  const run=assetId?await prisma.scanRun.findFirst({where:{scopeAssetId:assetId,type:'RECON'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}}):await prisma.targetReconRun.findFirst({where:{programId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
  if(!row)return{summary:null,stale:false};
  const{input:source,...visible}=row;const expected=(source as unknown as {metadata?:{sourceAuthorizationFingerprint?:string}})?.metadata?.sourceAuthorizationFingerprint;
  const policyChanged=Boolean(expected&&expected!==await currentAuthorizationFingerprint(prisma,userId,programId));
  return{summary:visible,stale:policyChanged||row.promptVersion!==SUMMARY_PROMPT_VERSION||Boolean(run&&(row.scanRunId??row.targetReconRunId)!==run.id)};
}
export async function processReconSummary(id:string,shutdown?:AbortSignal){
  const claimed=await prisma.reconSummary.updateMany({where:{id,status:'PENDING',program:{deletingAt:null},OR:[{scopeAssetId:null},{scopeAsset:{active:true}}]},data:{status:'RUNNING',startedAt:new Date()}});if(!claimed.count)return;
  const controller=new AbortController();let checking=false;let policy:{expected:string;userId:string;programId:string}|undefined;
  const check=setInterval(()=>{if(checking)return;checking=true;void prisma.reconSummary.count({where:{id,status:'RUNNING',program:{deletingAt:null},OR:[{scopeAssetId:null},{scopeAsset:{active:true}}]}}).then(async n=>{if(!n||policy&&policy.expected!==await currentAuthorizationFingerprint(prisma,policy.userId,policy.programId))controller.abort();}).catch(()=>controller.abort()).finally(()=>{checking=false;});},1000);
  try{
    const job=await prisma.reconSummary.findUniqueOrThrow({where:{id},include:{program:{select:{ownerId:true}}}});
    const expected=(job.input as unknown as {metadata?:{sourceAuthorizationFingerprint?:string}})?.metadata?.sourceAuthorizationFingerprint;
    if(expected){policy={expected,userId:job.program.ownerId,programId:job.programId};if(expected!==await currentAuthorizationFingerprint(prisma,policy.userId,policy.programId)){controller.abort();throw new Error('Source authorization changed');}}
    const client=new BrainClient({provider:'OLLAMA',baseUrl:job.endpoint,model:job.model});
    const signal=AbortSignal.any([controller.signal,...(shutdown?[shutdown]:[])]);
    let content:unknown;
    if(job.promptVersion==='recon-summary/1'){
      const input=job.input as unknown as ReturnType<typeof summaryInput>;
      const raw=await client.chat(SUMMARY_SYSTEM+'\nOutput JSON schema:\n'+JSON.stringify(z.toJSONSchema(reconSummarySchema)),JSON.stringify(input),{format:z.toJSONSchema(reconSummarySchema),temperature:0,maxTokens:2400,retries:0,timeoutMs:120000,maxResponseBytes:131072,signal});
      content=validateReconSummary(raw,input);
    }else content=await generateReconReport(client,job.input as unknown as ReconReportInput,{signal});
    await prisma.$transaction(async tx=>{
      const authorized=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${job.programId} AND "ownerId"=${job.program.ownerId} AND "deletingAt" IS NULL FOR SHARE`;
      if(!authorized.length){controller.abort();return;}
      await lockExecutionScopes(tx,job.programId);
      if(policy&&policy.expected!==await currentAuthorizationFingerprint(tx,policy.userId,policy.programId)){controller.abort();await tx.reconSummary.updateMany({where:{id,status:'RUNNING'},data:{status:'CANCELLED',error:'SOURCE_REVOKED: Authorization changed during report generation.'}});return;}
      await tx.reconSummary.updateMany({where:{id,status:'RUNNING',program:{deletingAt:null},OR:[{scopeAssetId:null},{scopeAsset:{active:true}}]},data:{status:'READY',content:asJson(content),generatedAt:new Date()}});
    });
  }catch(error){
    const cancelled=controller.signal.aborted;
    const reason=cancelled?'SOURCE_REVOKED: Source authorization changed; report discarded.':shutdown?.aborted?'WORKER_RESTART: Report will resume after restart.':error instanceof ReconReportValidationError?'FACTUAL_VALIDATION: Model proposed unsupported facts or evidence references.':error instanceof z.ZodError||error instanceof SyntaxError?'REPORT_SCHEMA: Model output remained invalid after bounded correction.':error instanceof BrainError&&error.status?'OLLAMA_UNAVAILABLE: Configured server returned HTTP '+error.status+'.':/timeout|timed out|aborted/i.test(error instanceof Error?error.message:'')?'OLLAMA_TIMEOUT: Model response exceeded the bounded timeout.':'REPORT_UNAVAILABLE: Report could not be generated.';
    await prisma.reconSummary.updateMany({where:{id,status:'RUNNING'},data:{status:cancelled?'CANCELLED':shutdown?.aborted?'PENDING':'FAILED',...(shutdown?.aborted&&!cancelled?{startedAt:null}:{}),error:reason+' Recon evidence remains valid.'}});
  }finally{clearInterval(check);}
}
export async function scheduleFinishedSummaries(){
  const assets=await prisma.scopeAsset.findMany({where:{active:true,program:{deletingAt:null,owner:{aiProviderConfig:{some:{provider:'OLLAMA',model:{not:null},baseUrl:{not:null}}}}}},orderBy:{updatedAt:'desc'},take:1000,select:{id:true,programId:true,program:{select:{ownerId:true}},scanRuns:{where:{type:'RECON'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,status:true,_count:{select:{artifacts:true,reconSummaries:{where:{promptVersion:SUMMARY_PROMPT_VERSION}}}}}}}});
  let scheduled=0;
  for(const a of assets){const run=a.scanRuns[0];if(run&&terminal.includes(run.status)&&run._count.artifacts&&!run._count.reconSummaries){try{await scheduleReconSummary(a.program.ownerId,a.programId,a.id);}catch{/* Optional. */}if(++scheduled>=5)break;}}
  const programs=[...new Set(assets.map(a=>a.programId))];
  const parents=await prisma.targetReconRun.findMany({where:{programId:{in:programs}},orderBy:[{createdAt:'desc'},{id:'desc'}],distinct:['programId'],take:1000,select:{id:true,programId:true,status:true,program:{select:{ownerId:true}},_count:{select:{reconSummaries:{where:{promptVersion:SUMMARY_PROMPT_VERSION}}}},scans:{select:{status:true,_count:{select:{artifacts:true}},reconSummaries:{where:{promptVersion:SUMMARY_PROMPT_VERSION},select:{status:true}}}}}});
  for(const p of parents)if(terminal.includes(p.status)&&!p._count.reconSummaries&&p.scans.some(s=>s._count.artifacts)&&!p.scans.some(s=>s._count.artifacts&&(!s.reconSummaries.length||s.reconSummaries.some(j=>['PENDING','RUNNING'].includes(j.status)))))try{await scheduleReconSummary(p.program.ownerId,p.programId);}catch{/* Optional. */}

}
export function startReconSummaryWorker(){
  const stop=new AbortController();let pending:Promise<void>=Promise.resolve(),timer:ReturnType<typeof setTimeout>|undefined;
  const tick=async()=>{try{
    await prisma.reconSummary.updateMany({where:{status:'RUNNING',startedAt:{lt:new Date(Date.now()-240000)}},data:{status:'FAILED',error:'Summary worker interrupted; regenerate to retry.'}});
    await prisma.reconSummary.updateMany({where:{status:{in:['PENDING','RUNNING']},OR:[{program:{deletingAt:{not:null}}},{scopeAsset:{active:false}}]},data:{status:'CANCELLED'}});
    await scheduleFinishedSummaries();
    const job=await prisma.reconSummary.findFirst({where:{status:'PENDING'},orderBy:{createdAt:'asc'},select:{id:true}});if(job)await processReconSummary(job.id,stop.signal);
  }catch{/* Durable task is recoverable after database restoration. */}finally{if(!stop.signal.aborted)timer=setTimeout(()=>{pending=tick();},2000);}};
  pending=tick();return{async close(){stop.abort();clearTimeout(timer);await pending;}};
}
