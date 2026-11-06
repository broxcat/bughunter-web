import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {lifecycleChangeSchema,lifecycleNext,retestResultSchema,type LifecycleView} from '@/lib/findingLifecycle';
import {safeSurfaceUrl} from '@/lib/authenticatedRecon';
import {findingReviewStatus} from '@/lib/evidenceReview';
import {redactEvidenceText} from '@/lib/evidenceVault';
import {ownedEvidenceTarget,linkEvidence} from './evidenceVault';
import {ResearchError,exportText,assertResearchTarget,researchAuthorizationMatches} from './research/workspace';
import {reconScopePolicy} from './research/reconPolicy';
const clean=(s:string)=>redactEvidenceText(exportText(s));
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function owned(tx:Prisma.TransactionClient,userId:string,id:string,write=false){
 const f=await tx.finding.findFirst({where:{id,target:{userId}},select:{targetId:true}});if(!f)throw new ResearchError('Finding not found',404);
 const target=await ownedEvidenceTarget(tx,userId,f.targetId,write,false);
 if(write){await tx.$queryRaw`SELECT id FROM "Scope" WHERE id=${target.scope.id} FOR SHARE`;if(target.program)await tx.$queryRaw`SELECT id FROM "BountyProgram" WHERE id=${target.program.id} FOR SHARE`;const asset=target.scopeAsset??target.discoveredFromAsset;if(asset)await tx.$queryRaw`SELECT id FROM "ScopeAsset" WHERE id=${asset.id} FOR SHARE`;await tx.$queryRaw`SELECT id FROM "Finding" WHERE id=${id} FOR UPDATE`;}
 const finding=await tx.finding.findUniqueOrThrow({where:{id},include:{vaultEvidence:true}});return{finding,target};
}
export async function findingLifecycle(userId:string,id:string):Promise<LifecycleView>{return prisma.$transaction(async tx=>{
 const {finding:f}=await owned(tx,userId,id);
 const events=await tx.findingLifecycleEvent.findMany({where:{findingId:id},orderBy:{revision:'desc'},take:100}),retests=await tx.findingRetest.findMany({where:{findingId:id},orderBy:{createdAt:'desc'},take:100,include:{result:true}});
 return{state:f.lifecycle,revision:f.lifecycleRevision,submission:f.submission as LifecycleView['submission'],next:lifecycleNext(f.lifecycle),events:events.map(e=>({...e,reason:clean(e.reason),createdAt:e.createdAt.toISOString()})),retests:retests.map(r=>({...r,reason:clean(r.reason),createdAt:r.createdAt.toISOString(),result:r.result?{...r.result,performedAt:r.result.performedAt.toISOString(),conclusion:clean(r.result.conclusion)}:null}))};
});}
export async function changeFindingLifecycle(userId:string,id:string,raw:unknown){
 const parsed=lifecycleChangeSchema.safeParse(raw);if(!parsed.success)throw new ResearchError('Invalid lifecycle decision, validation or submission metadata',400);const input=parsed.data;
 return prisma.$transaction(async tx=>{
  const {finding:f}=await owned(tx,userId,id,true),reason=clean(input.reason),validation=input.validation?{...input.validation,conclusion:clean(input.validation.conclusion),negativeControlReason:clean(input.validation.negativeControlReason)}:undefined;
  const submission=input.submission?json(Object.fromEntries(Object.entries(input.submission).map(([k,v])=>[k,k==='reportUrl'?safeSurfaceUrl(String(v)):typeof v==='string'?clean(v):v]))):undefined;
  const fingerprint=hash({...input,reason,validation,submission}),replay=await tx.findingLifecycleEvent.findUnique({where:{findingId_eventKey:{findingId:id,eventKey:input.eventKey}}});if(replay){if(replay.contentSha256!==fingerprint)throw new ResearchError('Decision identity already used',409);return{id:replay.id,revision:replay.revision};}
  if(f.lifecycleRevision!==input.expectedRevision)throw new ResearchError('Finding lifecycle changed; reload',409);
  if(!lifecycleNext(f.lifecycle).includes(input.state)&&!(f.lifecycle===input.state&&input.submission))throw new ResearchError('Unsupported lifecycle transition',400);
  if(f.lifecycleRevision>=100)throw new ResearchError('Lifecycle history limit reached; retained history remains readable',422);
  if(input.state==='VALIDATED'){
   const target=await ownedEvidenceTarget(tx,userId,f.targetId,false,true);assertResearchTarget(target,userId);
   if(!input.validation||findingReviewStatus(f)!=='CONFIRMED'||!f.vaultEvidence.some(e=>e.role==='SUPPORTS')||!f.location||!reconScopePolicy(target).inScope(f.location.startsWith('/')?new URL(f.location,`${target.scheme??'https'}://${target.host}`).href:f.location))throw new ResearchError('Validation requires completed evidence review, supporting Vault evidence, an authorized location and explicit reproduction/impact/control checks',400);
  }
  if(['READY_TO_SUBMIT','SUBMITTED'].includes(input.state)&&findingReviewStatus(f)!=='CONFIRMED')throw new ResearchError('Confirmed evidence review is required before submission',400);
  const effectiveSubmission=(submission??f.submission) as {submittedAt?:string}|null;
  if(input.state==='SUBMITTED'&&!effectiveSubmission?.submittedAt)throw new ResearchError('Record platform and submittedAt before marking submitted',400);
  if(effectiveSubmission?.submittedAt&&Date.parse(effectiveSubmission.submittedAt)>Date.now()+60000)throw new ResearchError('Submission date cannot be in the future',400);
  if(input.state==='RETEST_REQUIRED'){
   if(await tx.findingRetest.findFirst({where:{findingId:id,result:null}}))throw new ResearchError('An unfinished retest already exists',409);
   const originalEvidenceIds=[...new Set(f.vaultEvidence.map(e=>e.evidenceId))];if(!originalEvidenceIds.length)throw new ResearchError('Link original Vault evidence before requesting a retest',400);
   await tx.findingRetest.create({data:{findingId:id,requestedBy:userId,reason,originalEvidenceIds}});
   const covered=await tx.researchCoverage.findMany({where:{targetId:f.targetId,state:{notIn:['NOT_TESTED','NEEDS_RETEST']},OR:[{surface:f.location??''},{events:{some:{findingReferenceId:id}}}]},include:{events:{orderBy:{revision:'desc'},take:1}}});
   for(const c of covered){const previous=c.events[0];if(!previous)continue;const eventKey=hash(['FINDING_RETEST',id,input.eventKey,c.id]);await tx.researchCoverageEvent.create({data:{coverageId:c.id,targetId:f.targetId,eventKey,contentSha256:eventKey,revision:c.revision+1,state:'NEEDS_RETEST',action:'Finding retest requested; no test performed',result:reason,evidence:[],performedAt:new Date(),actorId:userId,source:'FINDING_RETEST',sessionReferenceId:previous.sessionReferenceId,findingReferenceId:id}});await tx.researchCoverage.update({where:{id:c.id},data:{state:'NEEDS_RETEST',revision:c.revision+1}});}
  }
  if(f.lifecycle==='RETEST_REQUIRED'&&['CLOSED','RESOLVED','VALIDATING'].includes(input.state)){
   const retest=await tx.findingRetest.findFirst({where:{findingId:id},orderBy:{createdAt:'desc'},include:{result:true}});
   if(!retest?.result)throw new ResearchError('Record the pending retest result before leaving retest required',400);
   if(input.state==='CLOSED'&&retest.result.outcome!=='FIX_CONFIRMED')throw new ResearchError('Closing a retest requires a confirmed fix; keep other outcomes open for review',400);
  }
  const event=await tx.findingLifecycleEvent.create({data:{findingId:id,eventKey:input.eventKey,contentSha256:fingerprint,revision:f.lifecycleRevision+1,previous:f.lifecycle,state:input.state,actorId:userId,reason,validation:validation?json(validation):undefined,submission}});
  await tx.finding.update({where:{id},data:{lifecycle:input.state,lifecycleRevision:event.revision,submission}});return{id:event.id,revision:event.revision};
 },{timeout:20000});
}
export async function recordFindingRetest(userId:string,id:string,raw:unknown){
 const parsed=retestResultSchema.safeParse(raw);if(!parsed.success)throw new ResearchError('Retest requires a dated conclusion, session and new proof (unless blocked)',400);const input=parsed.data;
 return prisma.$transaction(async tx=>{
  const {finding:f}=await owned(tx,userId,id,true),retest=await tx.findingRetest.findFirst({where:{id:input.retestId,findingId:id},include:{result:true}});
  if(!retest)throw new ResearchError('Retest activity not found',404);if(retest.result)throw new ResearchError('Retest results are immutable; request another retest instead',409);
  if(f.lifecycle!=='RETEST_REQUIRED')throw new ResearchError('Finding is not awaiting a retest',409);
  const when=new Date(input.performedAt);if(when>new Date(Date.now()+60000)||when<retest.createdAt)throw new ResearchError('Retest must be dated after its request and before now',400);
  if(input.outcome!=='CANNOT_RETEST'){
   const target=await ownedEvidenceTarget(tx,userId,f.targetId,false,true);const session=await tx.researchSession.findFirst({where:{id:input.sessionId,targetId:f.targetId,userId,status:'READY'},select:{authorizationSnapshot:true}});
   if(!session||!researchAuthorizationMatches(session.authorizationSnapshot,target)||!f.location||!reconScopePolicy(target).inScope(f.location.startsWith('/')?new URL(f.location,`${target.scheme??'https'}://${target.host}`).href:f.location))throw new ResearchError('Retest needs a current authorized Research session and location',400);
   if(input.evidenceIds.every(e=>retest.originalEvidenceIds.includes(e))||!await tx.evidenceRecord.findFirst({where:{id:{in:input.evidenceIds,notIn:retest.originalEvidenceIds},targetId:f.targetId,createdAt:{gte:retest.createdAt}},select:{id:true}}))throw new ResearchError('Retest requires new evidence; retain original proof separately',400);
  }
  if(input.sessionId&&!await tx.researchSession.findFirst({where:{id:input.sessionId,targetId:f.targetId,userId},select:{id:true}}))throw new ResearchError('Research session not found for this Target',404);
  const ids=[...new Set(input.evidenceIds)];if(await tx.evidenceRecord.count({where:{id:{in:ids},targetId:f.targetId}})!==ids.length)throw new ResearchError('Retest evidence must belong to this Target',400);
  for(const evidenceId of ids)await linkEvidence(tx,userId,f.targetId,evidenceId,{entity:'finding',id,role:'CONTEXT'});
  return tx.findingRetestResult.create({data:{retestId:retest.id,outcome:input.outcome,actorId:userId,sessionReferenceId:input.sessionId,performedAt:when,conclusion:clean(input.conclusion),evidenceIds:ids}});
 },{timeout:20000});
}
