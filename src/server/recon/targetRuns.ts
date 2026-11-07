import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assetValueRank, detectScopeAsset } from '@/lib/scopeAssets';
import { isExcluded, matchesHost } from '@/lib/bountyProgram';
import { buildReconPlan } from '@/lib/reconPlanner';
import { assetSnapshot, backfillProgramAssets, lockOwnedProgram } from '../scopeAssets';
import { ResearchError } from '../research/workspace';
import { publishScanJob } from '../queue/scanJobPublisher';
import { requestScanCancellation, settleQueuedCancellations } from '../queue/scanCancellation';
import { RATE_LIMIT_POLICIES } from '@/lib/abusePolicy';
import { captureProgramAssessment } from '../assessment';
import { captureAuthenticatedContexts } from '../authenticatedRecon';

export async function startTargetRecon(userId:string,programId:string) {
  const parent=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const program=await lockOwnedProgram(tx,userId,programId);await backfillProgramAssets(tx,programId,userId);
    const live=await tx.targetReconRun.findFirst({where:{programId,status:{in:['QUEUED','RUNNING']}},include:{scans:{select:{id:true}}}});if(live)return live;
    const assets=(await tx.scopeAsset.findMany({where:{programId,active:true},include:{executionTarget:{include:{scope:true}}}})).sort((a,b)=>assetValueRank(a.assetValue)-assetValueRank(b.assetValue)||a.normalizedValue.localeCompare(b.normalizedValue));
    if(!assets.length)throw new ResearchError('Add at least one active Scope Asset before Recon',400);
    if(assets.length>1000)throw new ResearchError('Target asset limit exceeded',422);
    const policy=RATE_LIMIT_POLICIES.scanUser;
    if(await tx.targetReconRun.count({where:{program:{ownerId:userId},createdAt:{gt:new Date(Date.now()-policy.windowSec*1000)}}})>=policy.limit)throw new ResearchError('Target Recon quota reached; retry later',429);
    if(await tx.scanRun.count({where:{scopeAssetId:{in:assets.map(a=>a.id)},status:{in:['QUEUED','RUNNING']}}}))throw new ResearchError('A previous asset Recon is still running; cancel or finish it first',409);
    const previous=new Set((await tx.scanRun.groupBy({by:['scopeAssetId'],where:{scopeAssetId:{in:assets.map(a=>a.id)},type:'RECON',status:'COMPLETED'},_count:true})).map(r=>r.scopeAssetId));
    const assessment=await captureProgramAssessment(tx,programId);
    const parent=await tx.targetReconRun.create({data:{programId,assessmentModeSnapshot:assessment.assessmentMode,assessmentSourcesSnapshot:assessment.authorizedSources as unknown as Prisma.InputJsonValue,preflight:{version:2,database:'AVAILABLE',queue:'PENDING',storage:'DATABASE',assetIds:assets.map(a=>a.id)}}});
    for(const [reconOrder,asset] of assets.entries()) {
      let target=asset.executionTarget;
      if(!target){const d=detectScopeAsset(asset.normalizedValue),host=d.hostname??asset.normalizedValue;
        const scope=await tx.scope.create({data:{userId,hostPattern:host,status:'APPROVED',programName:program.companyName}});
        target=await tx.target.create({data:{userId,programId,scopeId:scope.id,scopeAssetId:asset.id,host,scheme:asset.format==='URL'?new URL(asset.normalizedValue).protocol.slice(0,-1):'https',active:false},include:{scope:true}});
      }
      const host=asset.format==='URL'?new URL(asset.normalizedValue).hostname:asset.normalizedValue;
      const authContexts=await captureAuthenticatedContexts(tx,target.id);
      const plan=buildReconPlan(asset,{active:target.scope.status==='APPROVED'&&!(asset.format==='WILDCARD_DOMAIN'?program.outOfScope.some(rule=>matchesHost(host,rule)):isExcluded(host,program.outOfScope)),exclusions:program.outOfScope},{newSurface:!previous.has(asset.id),authenticatedContexts:authContexts.contexts.filter(context=>context.eligibility==='PLANNED').length});
      const scan=await tx.scanRun.create({data:{targetId:target.id,scopeAssetId:asset.id,targetReconRunId:parent.id,reconOrder,scopeAssetSnapshot:assetSnapshot(asset),assessmentModeSnapshot:parent.assessmentModeSnapshot,assessmentSourcesSnapshot:parent.assessmentSourcesSnapshot as Prisma.InputJsonValue,authenticatedContextsSnapshot:authContexts as unknown as Prisma.InputJsonValue,reconPlan:plan as unknown as Prisma.InputJsonValue,type:'RECON',reconSteps:{create:plan.stages.map((s,position)=>({name:s.name,position,reason:s.reason}))}}});
      await tx.scanJobOutbox.create({data:{scanRunId:scan.id}});
    }
    return tx.targetReconRun.findUniqueOrThrow({where:{id:parent.id},include:{scans:{select:{id:true}}}});
  },{timeout:30000});
  // Outbox retries recover Redis outages without changing immutable membership.
  const published=[];for(const scan of parent.scans)published.push(await publishScanJob(scan.id));
  await prisma.targetReconRun.update({where:{id:parent.id},data:{preflight:{...(parent.preflight as Prisma.JsonObject??{}),queue:published.every(p=>p.dispatch==='PUBLISHED')?'AVAILABLE':'DEGRADED_OUTBOX_PENDING'}}});
  return parent;
}
export function aggregateRecon(scans:{status:string;outcome:string|null;artifacts?:number}[],cancelled=false) {
  if(scans.some(s=>s.status==='RUNNING'))return{status:'RUNNING' as const,outcome:null};
  if(scans.some(s=>s.status==='QUEUED'))return{status:'QUEUED' as const,outcome:null};
  if(cancelled)return{status:'CANCELLED' as const,outcome:null};
  const useful=scans.some(s=>s.outcome==='SUCCESS'||s.outcome==='PARTIAL'||(s.artifacts??0)>0);
  if(scans.length&&scans.every(s=>s.status==='COMPLETED'&&s.outcome==='SUCCESS'))return{status:'COMPLETED' as const,outcome:'SUCCESS' as const};
  return{status:useful?'COMPLETED' as const:'FAILED' as const,outcome:useful?'PARTIAL' as const:'FAILED' as const};
}
export async function reconcileTargetRecon(id:string) {
  const parent=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "TargetReconRun" WHERE id=${id} FOR UPDATE`;
    const p=await tx.targetReconRun.findUnique({where:{id},include:{scans:{select:{id:true,status:true,outcome:true,startedAt:true,_count:{select:{artifacts:true}}}}}});if(!p)return null;
    const state=aggregateRecon(p.scans.map(s=>({...s,artifacts:s._count.artifacts})),Boolean(p.cancelRequestedAt));
    return tx.targetReconRun.update({where:{id},data:{...state,...(!p.startedAt&&p.scans.some(s=>s.startedAt)?{startedAt:p.scans.find(s=>s.startedAt)!.startedAt}:{}),...(!['RUNNING','QUEUED'].includes(state.status)&&!p.finishedAt?{finishedAt:new Date()}: {})}});
  });
  if(parent) {
    const {materializeReconMarkdown}=await import('../scopeMarkdown');
    await materializeReconMarkdown(parent.id);
  }
  return parent;
}
export async function maintainTargetRecons() {
  const rows=await prisma.targetReconRun.findMany({where:{OR:[{status:{in:['QUEUED','RUNNING']}},{scopeMarkdown:null}]},select:{id:true},orderBy:{createdAt:'asc'},take:20});
  for(const row of rows)await reconcileTargetRecon(row.id);
}
export async function cancelTargetRecon(userId:string,programId:string,id:string) {
  const parent=await prisma.targetReconRun.findFirst({where:{id,programId,program:{ownerId:userId}},include:{scans:{select:{id:true}}}});if(!parent)throw new ResearchError('Recon not found',404);
  if(!['QUEUED','RUNNING'].includes(parent.status))return parent;
  await prisma.targetReconRun.update({where:{id},data:{cancelRequestedAt:new Date()}});
  for(const scan of parent.scans)await requestScanCancellation(scan.id,userId);
  await settleQueuedCancellations();return reconcileTargetRecon(id);
}
export async function targetReconState(userId:string,programId:string) {
  const program=await prisma.bountyProgram.findFirst({where:{id:programId,ownerId:userId},select:{deletingAt:true}});if(!program)throw new ResearchError('Target not found',404);
  const recent=await prisma.targetReconRun.findMany({where:{programId},take:11,orderBy:[{createdAt:'desc'},{id:'desc'}],include:{scans:{select:{id:true,scopeAssetId:true,status:true,outcome:true,scopeAssetSnapshot:true,_count:{select:{artifacts:true}}}}}});
  const runs=recent.slice(0,10);
  const assets=await prisma.scopeAsset.findMany({where:{programId,active:true},select:{id:true,normalizedValue:true,format:true,type:true,assetValue:true}});
  const latest=runs[0],needsRecon=!assets.length||!latest||assets.some(a=>!latest.scans.some(s=>{const p=s.scopeAssetSnapshot as {normalizedValue?:string;format?:string;type?:string;assetValue?:string}|null;return s.scopeAssetId===a.id&&p?.normalizedValue===a.normalizedValue&&p.format===a.format&&p.type===a.type&&p.assetValue===a.assetValue;}));
  const findingsConfirmed=await prisma.finding.count({where:{target:{programId,userId},reviewStatus:'CONFIRMED'}}),researchStarted=await prisma.target.count({where:{programId,userId,OR:[{scopeAsset:{active:true}},{discoveredFromAsset:{active:true}},{contextOnly:true}],researchSessions:{some:{consoleTargetId:{not:null}}}}});
  return{latest:latest??null,runs,runsLimit:10,runsTruncated:recent.length>runs.length,needsRecon,findingsConfirmed,researchStarted,researchReady:Boolean(!program.deletingAt&&assets.length&&latest?.scopeMarkdown&&!needsRecon&&['COMPLETED','FAILED'].includes(latest.status))};
}
