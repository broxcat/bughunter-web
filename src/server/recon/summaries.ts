import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { BrainClient } from '../brain/client';
import { SUMMARY_PROMPT_VERSION,SUMMARY_SYSTEM,summaryInput,reconSummarySchema,validateReconSummary,type SummaryEvidence } from '@/lib/reconSummary';
import { ResearchError } from '../research/workspace';
import { z } from 'zod';
const terminal=['COMPLETED','FAILED'];
const asJson=(v:unknown)=>v as Prisma.InputJsonValue;
export async function ollamaSummaryConfig(userId:string){
  const config=await prisma.aiProviderConfig.findUnique({where:{userId_provider:{userId,provider:'OLLAMA'}}});
  if(!config?.baseUrl?.trim()||!config.model?.trim())return null;
  const url=new URL(config.baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return null;
  return {endpoint:config.baseUrl.replace(/\/+$/,''),model:config.model};
}
export async function buildSummaryInput(userId:string,programId:string,assetId?:string) {
  const program=await prisma.bountyProgram.findFirst({where:{id:programId,ownerId:userId,deletingAt:null}});if(!program)throw new ResearchError('Target unavailable',404);
  const parent=assetId?null:await prisma.targetReconRun.findFirst({where:{programId,status:{in:['COMPLETED','FAILED']}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  if(!assetId&&!parent)throw new ResearchError('No finished Target Recon',409);
  const assets=await prisma.scopeAsset.findMany({where:{programId,active:true,...(assetId?{id:assetId}:{scanRuns:{some:{targetReconRunId:parent!.id}}})},orderBy:[{assetValue:'asc'},{id:'asc'}],take:1000});
  if(!assets.length)throw new ResearchError('No active Scope Assets',409);
  const runs=await prisma.scanRun.findMany({where:{scopeAssetId:{in:assets.map(a=>a.id)},status:{in:['COMPLETED','FAILED']},...(parent?{targetReconRunId:parent.id}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:assetId?1:1000,include:{reconSteps:{orderBy:{position:'asc'}},_count:{select:{artifacts:true}}}});
  if(!runs.length||(!assetId&&runs.length!==assets.length))throw new ResearchError('Recon has not reached a terminal state',409);
  const evidence:SummaryEvidence[]=[];
  for(const run of runs){
    const asset=assets.find(a=>a.id===run.scopeAssetId)!;
    evidence.push({id:asset.id,kind:'asset',value:{original:asset.originalValue,normalized:asset.normalizedValue,format:asset.format,formatSource:asset.formatSource,type:asset.type,value:asset.assetValue,recon:run.status,outcome:run.outcome,runId:run.id,artifactCount:run._count.artifacts,capturedPlan:run.reconPlan ? (()=>{const plan=run.reconPlan as Record<string,unknown>;return{format:plan.format,type:plan.type,depth:plan.depth,activityMode:plan.activityMode,boundary:plan.boundary,...(assetId?{rationale:plan.rationale}:{})};})() : null}});
    for(const step of run.reconSteps)evidence.push({id:step.id,kind:'coverage',value:{assetId:asset.id,name:step.name,state:step.state,reason:step.reason}});
    if(run.changeSet)evidence.push({id:`changes:${run.id}`,kind:'change',value:run.changeSet});
    if(assetId){
      const principal=await prisma.reconArtifact.findMany({where:{scanRunId:run.id,kind:{notIn:['endpoint','url']}},orderBy:[{kind:'asc'},{canonicalKey:'asc'}],take:500});
      const dynamic=await prisma.reconArtifact.findMany({where:{scanRunId:run.id,kind:{in:['endpoint','url']},NOT:{OR:['/_next/static/','.js','.css','.png','.jpg','.svg','.woff'].map(value=>({value:{path:['url'],string_contains:value}}))}},orderBy:[{canonicalKey:'asc'}],take:1000});
      evidence.push(...[...principal,...dynamic].map(r=>({id:r.id,kind:r.kind,value:r.value,scopeState:r.scopeState,verification:r.verification,sources:r.sources})));
      const counts=await prisma.reconArtifact.groupBy({by:['kind'],where:{scanRunId:run.id},_count:true});evidence.push({id:`inventory:${run.id}`,kind:'coverage',value:{counts,sampledRecords:principal.length+dynamic.length,artifactCount:run._count.artifacts,staticAssets:'Summarized in scope.md; excluded from individual summary evidence.'}});
    }
    else {
      // Target synthesis consumes compact structured child summaries, not raw logs.
      const summary=await prisma.reconSummary.findFirst({where:{scanRunId:run.id,status:'READY'},orderBy:{createdAt:'desc'}});
      if(summary)evidence.push({id:summary.id,kind:'summary',value:{assetId:asset.id,llmGenerated:true,model:summary.model,content:summary.content}});
      const rows=await prisma.reconArtifact.findMany({where:{scanRunId:run.id,scopeState:'IN_SCOPE',kind:{in:['hostname','port','service','technology','api-surface','auth-surface']}},orderBy:[{kind:'asc'},{canonicalKey:'asc'}],take:30});
      evidence.push(...rows.map(r=>({id:r.id,kind:r.kind,value:r.value,scopeState:r.scopeState,verification:r.verification,sources:r.sources})));
    }
  }
  if(!runs.some(r=>r._count.artifacts>0))throw new ResearchError('No usable Recon evidence yet',409);
  const input=summaryInput({targetId:programId,target:program.companyName,exclusions:program.outOfScope,authorization:'Only explicit active Scope Assets; discoveries never grant authorization.',source:assetId?'asset':'target',runIds:runs.map(r=>r.id),targetReconRunId:parent?.id,coverageNote:'Input is bounded; omitted evidence remains in artifacts and scope.md.'},evidence);
  return{input,scanRunId:assetId?runs[0].id:undefined,targetReconRunId:parent?.id,scopeAssetId:assetId};
}
export async function scheduleReconSummary(userId:string,programId:string,assetId?:string,regenerate=false){
  const config=await ollamaSummaryConfig(userId);if(!config)throw new ResearchError('Configure an Ollama endpoint and model in Settings',409);
  const source=await buildSummaryInput(userId,programId,assetId);
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
  const row=await prisma.reconSummary.findFirst({where:{programId,...(assetId?{scopeAssetId:assetId}:{scopeAssetId:null})},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,status:true,model:true,promptVersion:true,sourceFingerprint:true,scanRunId:true,targetReconRunId:true,createdAt:true,generatedAt:true,content:true,error:true}});
  const run=assetId?await prisma.scanRun.findFirst({where:{scopeAssetId:assetId,type:'RECON'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}}):await prisma.targetReconRun.findFirst({where:{programId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
  return{summary:row,stale:Boolean(row&&run&&(row.scanRunId??row.targetReconRunId)!==run.id)};
}
export async function processReconSummary(id:string,shutdown?:AbortSignal){
  const claimed=await prisma.reconSummary.updateMany({where:{id,status:'PENDING',program:{deletingAt:null},OR:[{scopeAssetId:null},{scopeAsset:{active:true}}]},data:{status:'RUNNING',startedAt:new Date()}});if(!claimed.count)return;
  const controller=new AbortController();let checking=false;
  const check=setInterval(()=>{if(checking)return;checking=true;void prisma.reconSummary.count({where:{id,status:'RUNNING',program:{deletingAt:null},OR:[{scopeAssetId:null},{scopeAsset:{active:true}}]}}).then(n=>{if(!n)controller.abort();}).catch(()=>controller.abort()).finally(()=>{checking=false;});},1000);
  try{
    const job=await prisma.reconSummary.findUniqueOrThrow({where:{id}});
    const input=job.input as unknown as ReturnType<typeof summaryInput>;
    const client=new BrainClient({provider:'OLLAMA',baseUrl:job.endpoint,model:job.model});
    const raw=await client.chat(SUMMARY_SYSTEM+'\nOutput JSON schema:\n'+JSON.stringify(z.toJSONSchema(reconSummarySchema)),JSON.stringify(input),{format:z.toJSONSchema(reconSummarySchema),temperature:0,maxTokens:2400,retries:0,timeoutMs:120000,maxResponseBytes:131072,signal:AbortSignal.any([controller.signal,...(shutdown?[shutdown]:[])])});
    const content=validateReconSummary(raw,input);
    await prisma.reconSummary.updateMany({where:{id,status:'RUNNING',program:{deletingAt:null},OR:[{scopeAssetId:null},{scopeAsset:{active:true}}]},data:{status:'READY',content:asJson(content),generatedAt:new Date()}});
  }catch{
    await prisma.reconSummary.updateMany({where:{id,status:'RUNNING'},data:{status:controller.signal.aborted||shutdown?.aborted?'CANCELLED':'FAILED',error:'Summary unavailable or invalid. Recon evidence remains valid; retry from Summary.'}});
  }finally{clearInterval(check);}
}
export async function scheduleFinishedSummaries(){
  const assets=await prisma.scopeAsset.findMany({where:{active:true,program:{deletingAt:null,owner:{aiProviderConfig:{some:{provider:'OLLAMA',model:{not:null},baseUrl:{not:null}}}}}},orderBy:{updatedAt:'desc'},take:1000,select:{id:true,programId:true,program:{select:{ownerId:true}},scanRuns:{where:{type:'RECON'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,status:true,_count:{select:{artifacts:true,reconSummaries:true}}}}}});
  let scheduled=0;
  for(const a of assets){const run=a.scanRuns[0];if(run&&terminal.includes(run.status)&&run._count.artifacts&&!run._count.reconSummaries){try{await scheduleReconSummary(a.program.ownerId,a.programId,a.id);}catch{/* Optional. */}if(++scheduled>=5)break;}}
  const programs=[...new Set(assets.map(a=>a.programId))];
  const parents=await prisma.targetReconRun.findMany({where:{programId:{in:programs}},orderBy:[{createdAt:'desc'},{id:'desc'}],distinct:['programId'],take:1000,select:{id:true,programId:true,status:true,program:{select:{ownerId:true}},_count:{select:{reconSummaries:true}},scans:{select:{status:true,_count:{select:{artifacts:true}},reconSummaries:{select:{status:true}}}}}});
  for(const p of parents)if(terminal.includes(p.status)&&!p._count.reconSummaries&&p.scans.some(s=>s._count.artifacts)&&!p.scans.some(s=>s._count.artifacts&&(!s.reconSummaries.length||s.reconSummaries.some(j=>['PENDING','RUNNING'].includes(j.status)))))try{await scheduleReconSummary(p.program.ownerId,p.programId);}catch{/* Optional. */}

}
export function startReconSummaryWorker(){
  const stop=new AbortController();let pending:Promise<void>=Promise.resolve(),timer:ReturnType<typeof setTimeout>|undefined;
  const tick=async()=>{try{
    await prisma.reconSummary.updateMany({where:{status:'RUNNING',startedAt:{lt:new Date(Date.now()-180000)}},data:{status:'FAILED',error:'Summary worker interrupted; regenerate to retry.'}});
    await prisma.reconSummary.updateMany({where:{status:{in:['PENDING','RUNNING']},OR:[{program:{deletingAt:{not:null}}},{scopeAsset:{active:false}}]},data:{status:'CANCELLED'}});
    await scheduleFinishedSummaries();
    const job=await prisma.reconSummary.findFirst({where:{status:'PENDING'},orderBy:{createdAt:'asc'},select:{id:true}});if(job)await processReconSummary(job.id,stop.signal);
  }catch{/* Durable task is recoverable after database restoration. */}finally{if(!stop.signal.aborted)timer=setTimeout(()=>{pending=tick();},2000);}};
  pending=tick();return{async close(){stop.abort();clearTimeout(timer);await pending;}};
}
