import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {historyHash,historySurface,historyText,compareHistory,type HistorySurface,type HistoryRow} from '@/lib/reconHistory';
import {safeSurfaceUrl} from '@/lib/authenticatedRecon';
import {ResearchError} from '../research/workspace';
import {readAuthSurface} from '../authenticatedRecon';

const terminal=['COMPLETED','FAILED','CANCELLED'];
/** Idempotent terminal publication. No network calls, Scope mutations or Finding creation. */
export async function publishReconHistory(scanId:string){
 return prisma.$transaction(async tx=>{
  const run=await tx.scanRun.findUnique({where:{id:scanId},include:{artifacts:{orderBy:{id:'asc'},take:10001}}});
  if(!run||run.type!=='RECON'||!terminal.includes(run.status)||!run.scopeAssetId)return;
  await tx.$queryRaw`SELECT id FROM "Target" WHERE id=${run.targetId} FOR UPDATE`;
  if(await tx.reconHistoryRun.findUnique({where:{scanReferenceId:scanId}}))return;
  const rows:HistorySurface[]=run.artifacts.slice(0,10000).flatMap(a=>{const r=historySurface(a.kind,{...(a.value as Record<string,unknown>),scopeState:a.scopeState,verification:a.verification},a.firstSeenAt.toISOString(),a.lastSeenAt.toISOString(),[a.id]);return r?[r]:[];});
  const auth=(await readAuthSurface([run.id],tx))[0];
  for(const observation of auth?.observations??[]){if(observation.responseClass==='UNAVAILABLE')continue;
   const row=historySurface('authentication-context',observation as unknown as Record<string,unknown>,observation.observedAt,observation.observedAt,observation.id?[observation.id]:[]);
   if(row){row.identity+=`:${historyHash(observation.contextKey)}`;row.details.context=observation.contextType;row.label+=observation.contextType==='ANONYMOUS'?' · Anonymous':` · Auth context ${historyHash(observation.contextKey).slice(0,8)}`;rows.push(row);}
  }
  // Relations use the already materialized graph; only node identities survive.
  const graph=(run.changeSet as {assetGraph?:{nodes?:Array<{id:string;type:string;value:string}>;edges?:Array<{from:string;to:string;relation:string;evidenceRefs?:string[];firstSeen?:string;lastSeen?:string}>}}|null)?.assetGraph;
  const nodes=new Map((graph?.nodes??[]).map(n=>[n.id,n]));
  const nodeLabel=(n:{type:string;value:string})=>{try{return /^https?:/.test(n.value)?safeSurfaceUrl(n.value):historyText(n.value);}catch{return '[unavailable]';}};
  for(const edge of (graph?.edges??[]).slice(0,5000)){
   const from=nodes.get(edge.from),to=nodes.get(edge.to);if(!from||!to||from.type==='AUTH_CONTEXT'||to.type==='AUTH_CONTEXT'||!edge.firstSeen||!edge.lastSeen)continue;
   if(!Number.isFinite(Date.parse(edge.firstSeen))||!Number.isFinite(Date.parse(edge.lastSeen)))continue;
   const details={from:nodeLabel(from),relation:historyText(edge.relation),to:nodeLabel(to)};
   rows.push({kind:'relation',identity:JSON.stringify(details),label:`${details.from} → ${details.relation} → ${details.to}`,details,sourceRefs:edge.evidenceRefs??[],firstSeenAt:edge.firstSeen,lastSeenAt:edge.lastSeen,staticAsset:false});
  }
  const previous=await tx.reconHistoryRun.findFirst({where:{targetId:run.targetId,scopeAssetReferenceId:run.scopeAssetId,runCreatedAt:{lt:run.createdAt}},orderBy:[{runCreatedAt:'desc'},{id:'desc'}],include:{observations:{include:{surface:true}}}});
  const history=await tx.reconHistoryRun.create({data:{targetId:run.targetId,scopeAssetReferenceId:run.scopeAssetId,scanRunId:run.id,scanReferenceId:run.id,runCreatedAt:run.createdAt,outcome:run.outcome??run.status,truncated:run.artifacts.length>10000||Boolean(auth?.truncated)||(graph?.edges?.length??0)>5000}});
  const merged=new Map<string,HistorySurface>();for(const row of rows){const id=historyHash([run.targetId,run.scopeAssetId,row.identity]);const old=merged.get(id);if(old){old.sourceRefs=[...new Set([...old.sourceRefs,...row.sourceRefs])];old.firstSeenAt=[old.firstSeenAt,row.firstSeenAt].sort()[0];old.lastSeenAt=[old.lastSeenAt,row.lastSeenAt].sort().at(-1)!;}else merged.set(id,row);}
  const current:HistoryRow[]=[];
  for(const [id,row]of merged){
   const fingerprint=historyHash(row.details),first=new Date(row.firstSeenAt),last=new Date(row.lastSeenAt);
   await tx.reconSurface.upsert({where:{id},create:{id,targetId:run.targetId,scopeAssetReferenceId:run.scopeAssetId,kind:row.kind,identity:row.identity,label:row.label,firstSeenAt:first,lastSeenAt:last},update:{}});
   await tx.$executeRaw`UPDATE "ReconSurface" SET "firstSeenAt"=LEAST("firstSeenAt",${first}), "lastSeenAt"=GREATEST("lastSeenAt",${last}) WHERE id=${id}`;
   await tx.reconSurfaceSeen.create({data:{historyId:history.id,surfaceId:id,fingerprint,details:{...row.details,staticAsset:row.staticAsset} as Prisma.InputJsonValue,sourceRefs:row.sourceRefs}});
   current.push({...row,id,fingerprint,observedRuns:1});
  }
  if(previous){const differences=compareHistory(current,previous.observations.map(seenRow));
   const affected=[...differences.changed,...differences.notObserved].filter(r=>!r.staticAsset),latest=await tx.reconHistoryRun.findFirst({where:{targetId:run.targetId,scopeAssetReferenceId:run.scopeAssetId},orderBy:[{runCreatedAt:'desc'},{id:'desc'}]});
   if(latest?.id===history.id&&affected.length)await flagCoverageRetest(tx,run.targetId,run.id,affected.map(r=>String(r.details.url??r.details.hostname??'')),run.createdAt);
  }
 },{timeout:120000});
}
function seenRow(row:Prisma.ReconSurfaceSeenGetPayload<{include:{surface:true}}>):HistoryRow{
 const details=row.details as Record<string,unknown>;return{id:row.surfaceId,kind:row.surface.kind,identity:row.surface.identity,label:row.surface.label,details,sourceRefs:row.sourceRefs,firstSeenAt:row.surface.firstSeenAt.toISOString(),lastSeenAt:row.surface.lastSeenAt.toISOString(),fingerprint:row.fingerprint,observedRuns:0,staticAsset:details.staticAsset===true};
}
async function flagCoverageRetest(tx:Prisma.TransactionClient,targetId:string,scanId:string,surfaces:string[],cutoff:Date){
 const rows=await tx.researchCoverage.findMany({where:{targetId,state:{in:['COVERED_NO_ISSUE_OBSERVED','INTERESTING','HYPOTHESIS_OPEN','FINDING']},surface:{in:surfaces}},include:{events:{orderBy:{revision:'desc'},take:1}}});
 for(const row of rows){const last=row.events[0];if(!last||last.createdAt>=cutoff)continue;const revision=row.revision+1,eventKey=historyHash(['RECON_DIFF',scanId,row.id]);
  await tx.researchCoverageEvent.create({data:{coverageId:row.id,targetId,eventKey,contentSha256:eventKey,revision,state:'NEEDS_RETEST',action:'Recon change flagged for researcher review; no test performed',result:`Surface changed or was not observed in Recon ${scanId}. Review coverage before retesting. Absence does not prove removal.`,evidence:[],performedAt:new Date(),actorId:'SYSTEM_RECON_DIFF',source:'RECON_DIFF',sessionReferenceId:last.sessionReferenceId,findingReferenceId:last.findingReferenceId}});
  await tx.researchCoverage.update({where:{id:row.id},data:{revision,state:'NEEDS_RETEST'}});
 }
}
export async function maintainReconHistory(){const runs=await prisma.scanRun.findMany({where:{type:'RECON',scopeAssetId:{not:null},status:{in:['COMPLETED','FAILED','CANCELLED']},surfaceHistory:null},orderBy:[{createdAt:'asc'},{id:'asc'}],take:10,select:{id:true}});for(const r of runs)await publishReconHistory(r.id);}
export async function reconHistory(userId:string,assetId:string,currentId?:string,previousId?:string){
 const asset=await prisma.scopeAsset.findFirst({where:{id:assetId,program:{ownerId:userId}},select:{id:true}});if(!asset)throw new ResearchError('Scope Asset not found',404);
 const scans=await prisma.scanRun.findMany({where:{scopeAssetId:assetId,type:'RECON',target:{userId},status:{in:['COMPLETED','FAILED','CANCELLED']}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,select:{id:true,status:true,outcome:true,createdAt:true}});
 const archived=await prisma.reconHistoryRun.findMany({where:{scopeAssetReferenceId:assetId,target:{userId}},orderBy:[{runCreatedAt:'desc'},{id:'desc'}],take:51});
 const candidates=[...new Map([...scans,...archived.map(r=>({id:r.scanReferenceId,createdAt:r.runCreatedAt,outcome:r.outcome,status:r.scanRunId?'COMPLETED':'ARCHIVED'}))].map(r=>[r.id,r])).values()].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id));
 const runs=candidates.slice(0,50);
 const chosen=currentId?runs.find(r=>r.id===currentId):runs[0],index=runs.findIndex(r=>r.id===chosen?.id),prior=previousId?runs.find(r=>r.id===previousId):runs[index+1];
 if(currentId&&!chosen||previousId&&!prior)throw new ResearchError('Select retained Recon runs for this Scope Asset',404);
 if(chosen&&prior&&(prior.createdAt>chosen.createdAt||prior.id===chosen.id))throw new ResearchError('Comparison must use an earlier Recon',400);
 // B5: this is a read path (GET). Publication, including coverage NEEDS_RETEST
 // writes, happens when a run finishes (processScan) and in execution
 // maintenance; a run not yet published is reported, never written from here.
 const load=async(id?:string)=>id?prisma.reconHistoryRun.findUnique({where:{scanReferenceId:id},include:{observations:{include:{surface:true}}}}):null;
 const [a,b]=await Promise.all([load(chosen?.id),load(prior?.id)]);
 const published=new Set((await prisma.reconHistoryRun.findMany({where:{scanReferenceId:{in:runs.map(r=>r.id)}},select:{scanReferenceId:true}})).map(r=>r.scanReferenceId));
 const rows=a?.observations.map(seenRow)??[],old=b?.observations.map(seenRow)??[];
 const ids=[...new Set([...rows,...old].map(r=>r.id))],counts=await prisma.reconSurfaceSeen.groupBy({by:['surfaceId'],where:{surfaceId:{in:ids}},_count:true});const countMap=new Map(counts.map(c=>[c.surfaceId,c._count]));for(const r of [...rows,...old])r.observedRuns=countMap.get(r.id)??0;
 return{runs,pendingPublication:runs.filter(r=>!published.has(r.id)).map(r=>r.id),runWindowLimit:50,runWindowTruncated:candidates.length>runs.length,currentId:chosen?.id??null,previousId:prior?.id??null,comparable:Boolean(a&&b),truncated:Boolean(a?.truncated||b?.truncated),notice:'Comparison selection is limited to the latest 50 retained runs to bound evidence processing; it is not complete run-history navigation. Observations do not grant Scope authorization. Not observed this run does not prove removal. Compare methodology and run coverage. First/last seen describe recorded observations, not continuous availability.',...compareHistory(rows,old)};
}
