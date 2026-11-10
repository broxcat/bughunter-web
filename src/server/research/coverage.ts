import {registerEvidence,linkEvidence} from '@/server/evidenceVault';
import {createHash} from 'node:crypto';
import {savedResearchReview} from '@/lib/research/humanReview';
import {findingReviewStatus} from '@/lib/evidenceReview';
import type { CoverageReviewMemory } from '@/lib/research/coverage';
import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {COVERAGE_NOTICE,coverageCounts,coverageRecordSchema,type CoverageView,type CoverageRecord,type CoverageEntry} from '@/lib/research/coverage';
import {safeSurfaceUrl,safeAuthLabel} from '@/lib/authenticatedRecon';
import {researchPlanState,researchPlanDetails} from './plans';
import {researchTargetSelect,assertResearchTarget,researchAuthorizationMatches,ResearchError,exportText} from './workspace';
import {ownedResearch,researchRootFor} from './sessions';
import {HypothesisWorkspace} from './hypothesisFiles';
import {reconScopePolicy} from './reconPolicy';
import type {ResearchPlanView} from '@/lib/researchPlanView';
const clean=(value:string)=>exportText(value).replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[REDACTED EMAIL]').slice(0,2000);
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const eventInclude={events:{orderBy:{revision:'desc' as const},take:1,include:{vaultEvidence:{select:{evidenceId:true}}}}};
async function owned(tx:Prisma.TransactionClient,userId:string,targetId:string,write=false){
 if(write)await tx.$queryRaw`SELECT id FROM "Target" WHERE id=${targetId} AND "userId"=${userId} FOR UPDATE`;
 let target=await tx.target.findFirst({where:{id:targetId,userId,program:{ownerId:userId,deletingAt:null}},select:researchTargetSelect});
 if(!target)throw new ResearchError('Target not found',404);
 if(write){await tx.$queryRaw`SELECT id FROM "Scope" WHERE id=${target.scope.id} FOR SHARE`;await tx.$queryRaw`SELECT id FROM "BountyProgram" WHERE id=${target.program!.id} FOR SHARE`;
  const boundary=target.scopeAsset??target.discoveredFromAsset;if(boundary)await tx.$queryRaw`SELECT id FROM "ScopeAsset" WHERE id=${boundary.id} FOR SHARE`;
  target=await tx.target.findFirst({where:{id:targetId,userId,program:{ownerId:userId,deletingAt:null}},select:researchTargetSelect});if(!target)throw new ResearchError('Target not found',404);
 }
 if(write)assertResearchTarget(target,userId);
 return target;
}
const safeEvent=(e:Prisma.ResearchCoverageEventGetPayload<object>&{vaultEvidence?:Array<{evidenceId:string}>})=>({id:e.id,revision:e.revision,state:e.state,action:clean(e.action),result:clean(e.result),evidenceIds:e.vaultEvidence?.map(v=>v.evidenceId)??[],evidence:(e.evidence as Array<{ref:string;summary:string}>).map(v=>({ref:v.ref,summary:clean(v.summary)})),performedAt:e.performedAt.toISOString(),createdAt:e.createdAt.toISOString(),source:e.source,sessionReferenceId:e.sessionReferenceId,hypothesisReferenceId:e.hypothesisReferenceId,hypothesisTestId:e.hypothesisTestId,findingReferenceId:e.findingReferenceId});
async function coverageReviewMemory(tx: Prisma.TransactionClient, userId: string, targetId: string, objectiveKeys: string[]) {
  if (!objectiveKeys.length) return { reviews: [], truncated: false };
  const limit = 30;
  const rows = await tx.researchHypothesisRevision.findMany({
    where: {
      humanReview: { not: Prisma.DbNull },
      hypothesis: {
        session: { targetId, ...ownedResearch(userId) },
        planItem: { stableKey: { in: objectiveKeys }, plan: { targetId } },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      humanReview: true, revision: true, snapshot: true,
      hypothesis: {
        select: {
          id: true, externalId: true, sessionId: true, revision: true,
          planItem: { select: { id: true, stableKey: true } },
          promotion: { select: { hypothesisRevision: true, finding: { select: { id: true, reviewStatus: true, gateStatus: true, reviewEvidence: true, lifecycle: true } } } },
        },
      },
    },
  });
  const reviews: CoverageReviewMemory[] = [];
  for (const { hypothesis, humanReview, revision, snapshot } of rows.slice(0, limit)) {
    const result = savedResearchReview.safeParse(humanReview);
    if (!result.success || !hypothesis.planItem ||
      (snapshot as { planItemId?: string } | null)?.planItemId !== hypothesis.planItem.id) continue;
    const review = result.data;
    const finding = hypothesis.promotion?.hypothesisRevision === revision ? hypothesis.promotion.finding : null;
    reviews.push({
      objectiveKey: hypothesis.planItem.stableKey, hypothesisId: hypothesis.id, sessionId: hypothesis.sessionId,
      externalId: hypothesis.externalId, revision, currentRevision: revision === hypothesis.revision,
      verdict: review.verdict, reason: clean(review.reason).slice(0, 300), reviewedAt: review.reviewedAt,
      ...(review.verdict === 'SUPPORTED' ? { testId: review.testId } : {}),
      ...(finding ? { finding: { id: finding.id, reviewStatus: findingReviewStatus(finding), lifecycle: finding.lifecycle } } : {}),
    });
  }
  return { reviews, truncated: rows.length > limit };
}

export async function coverageView(tx:Prisma.TransactionClient,userId:string,targetId:string,plan:ResearchPlanView|null):Promise<CoverageView>{
 const target=await owned(tx,userId,targetId);let readOnly=false;try{assertResearchTarget(target,userId);}catch{readOnly=true;}
 const rows=await tx.researchCoverage.findMany({where:{targetId},orderBy:{id:'asc'},take:501,include:eventInclude});
 const entries:CoverageEntry[]=rows.slice(0,500).map(({events,...row})=>({...row,events:events.map(safeEvent)}));
 const session=await tx.researchSession.findFirst({where:{targetId,...ownedResearch(userId),consoleTargetId:targetId,status:'READY'},select:{id:true}});
 const objectives=(plan?.items??[]).filter(i=>i.status==='READY').map(i=>({id:i.id,stableKey:i.stableKey,title:i.title,category:i.category,surfaces:i.surfaceRefs.map(s=>({url:s.url,method:s.method})),contexts:[{contextKey:'UNKNOWN',label:'Context not captured'},{contextKey:'ANONYMOUS',label:'Anonymous'},...i.contextRefs.filter(c=>!['UNKNOWN','ANONYMOUS'].includes(c.contextKey)).map(c=>({contextKey:c.contextKey,label:safeAuthLabel(c.label)}))],untested:!entries.some(e=>e.objectiveKey===i.stableKey&&e.contextRunId===plan!.scanRunId&&e.state!=='NOT_TESTED')}));
 const memory = await coverageReviewMemory(tx, userId, targetId, objectives.map(objective => objective.stableKey));
 return{version:1,targetId,planId:plan?.id??null,contextRunId:plan?.scanRunId??null,sessionId:readOnly?null:session?.id??null,notice:COVERAGE_NOTICE+(readOnly?' Current scope is inactive; historical coverage is read-only.':''),truncated:rows.length>500||memory.truncated,...(memory.reviews.length?{reviewMemory:memory.reviews}:{}),entries,objectives,counts:coverageCounts(entries,objectives.filter(o=>!entries.some(e=>e.objectiveKey===o.stableKey&&e.contextRunId===plan?.scanRunId)).length)};
}
export async function researchCoverageState(userId:string,targetId:string){
 let current;try{current=await researchPlanState(userId,targetId);}catch(e){if(e instanceof ResearchError&&[400,409].includes(e.status))return prisma.$transaction(tx=>coverageView(tx,userId,targetId,null));throw e;}
 const session=await prisma.researchSession.findFirst({where:{consoleTargetId:targetId,...ownedResearch(userId)},select:{researchPlanId:true,id:true}});
 const delivered=session?await prisma.researchReconDelivery.findFirst({where:{sessionId:session.id,status:'STAGED'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{snapshot:{select:{researchPlanId:true}}}}):null;
 const id=delivered?.snapshot.researchPlanId??session?.researchPlanId;
 const plan=id?await researchPlanDetails(userId,id):current.plan;
 return prisma.$transaction(tx=>coverageView(tx,userId,targetId,plan),{timeout:20000});
}
async function record(tx:Prisma.TransactionClient,userId:string,targetId:string,raw:unknown,source:'RESEARCHER'|'WORKSPACE_IMPORT'){
 const parsed=coverageRecordSchema.safeParse(raw);if(!parsed.success)throw new ResearchError('Invalid coverage record. Check state, contexts, revision and evidence.',400);
 const input:CoverageRecord=parsed.data,target=await owned(tx,userId,targetId,true);
 const session=await tx.researchSession.findFirst({where:{id:input.sessionId,targetId,...ownedResearch(userId)},select:{id:true,status:true,workspaceId:true,authorizationSnapshot:true}});
 if(!session)throw new ResearchError('Research session not found',404);
 if(session.status!=='READY'||!researchAuthorizationMatches(session.authorizationSnapshot,target))throw new ResearchError('Research session or current authorization needs review',409);
 const item=await tx.researchPlanItem.findFirst({where:{id:input.planItemId,plan:{targetId,program:{ownerId:userId}}},include:{plan:true}});
 if(!item||item.status!=='READY')throw new ResearchError('Research objective not found',404);
 const surfaces=item.surfaceRefs as Array<{url:string;method?:string}>;
 if(!surfaces.some(s=>s.url===input.surface)||!reconScopePolicy(target).inScope(input.surface))throw new ResearchError('Coverage surface is outside the objective or current scope',400);
 const contexts=[{contextKey:'UNKNOWN',label:'Context not captured'},{contextKey:'ANONYMOUS',label:'Anonymous'},...(item.contextRefs as Array<{contextKey:string;label:string}>)];
 const context=contexts.find(c=>c.contextKey===input.contextKey),comparison=input.comparisonKey?contexts.find(c=>c.contextKey===input.comparisonKey):null;
 if(!context||input.comparisonKey&&!comparison)throw new ResearchError('Select a captured authentication context',400);
 const when=new Date(input.performedAt);if(when.getTime()>Date.now()+60000||when.getTime()<new Date('2000-01-01').getTime())throw new ResearchError('Invalid test date',400);
 if(input.hypothesisId){const hypothesis=await tx.researchHypothesis.findFirst({where:{id:input.hypothesisId,session:{targetId,userId}},select:{id:true,planItem:{select:{stableKey:true}},researchData:true}});
  if(!hypothesis||hypothesis.planItem?.stableKey!==item.stableKey)throw new ResearchError('Hypothesis must belong to this objective and Target',400);
  if(input.hypothesisTestId&&!((hypothesis.researchData as {tests?:Array<{id:string}>}|null)?.tests??[]).some(t=>t.id===input.hypothesisTestId))throw new ResearchError('Hypothesis test not found',400);
 }
 if(input.findingId&&!await tx.finding.findFirst({where:{id:input.findingId,targetId},select:{id:true}}))throw new ResearchError('Finding must belong to this Target',400);
 const evidence=input.evidence.map(e=>({ref:e.ref,summary:clean(e.summary)}));
 if(evidence.length){const workspace=await HypothesisWorkspace.open(researchRootFor(session.workspaceId),session.workspaceId);
 try{for(const e of evidence){if(exportText(e.ref)!==e.ref)throw new ResearchError('Remove secrets from artifact names',400);await workspace.checkReference(e.ref);}}finally{await workspace.close();}}
 if(exportText(input.testKey)!==input.testKey)throw new ResearchError('Use a non-secret test identity',400);
 const surface=safeSurfaceUrl(input.surface),coverageKey=hash([input.testKey,item.stableKey,item.plan.scopeAssetId,surface,input.method,input.contextKey,input.comparisonKey,item.plan.scanRunId]);
 const action=clean(input.action),result=clean(input.result);
 const {evidenceIds,...withoutVault}=input;
 const canonicalInput=evidenceIds.length?{...withoutVault,evidenceIds}:withoutVault;
 const contentSha256=hash({coverageKey,...canonicalInput,surface:undefined,action,result,evidence,source});
 const replay=await tx.researchCoverageEvent.findUnique({where:{targetId_eventKey:{targetId,eventKey:input.eventKey}}});
 if(replay){if(replay.contentSha256!==contentSha256)throw new ResearchError('Event identity already used with different content',409);return replay;}
 const existing=await tx.researchCoverage.findUnique({where:{targetId_coverageKey:{targetId,coverageKey}}});
 if((existing?.revision??0)!==input.expectedRevision)throw new ResearchError('Coverage changed. Reload before recording another event.',409);
 if(await tx.researchCoverageEvent.count({where:{targetId}})>=10000)throw new ResearchError('Coverage event limit reached; retained history remains available',422);
 if(!existing&&await tx.researchCoverage.count({where:{targetId}})>=500)throw new ResearchError('Coverage dimension limit reached; retained history remains available',422);
 const stream=existing??await tx.researchCoverage.create({data:{targetId,scopeAssetReferenceId:item.plan.scopeAssetId,planItemReferenceId:item.id,scopeAssetId:item.plan.scopeAssetId,planItemId:item.id,objectiveKey:item.stableKey,coverageKey,category:item.category,surface,method:input.method,contextKey:input.contextKey,contextLabel:safeAuthLabel(context.label),comparisonKey:input.comparisonKey,comparisonLabel:comparison?safeAuthLabel(comparison.label):null,contextRunId:item.plan.scanRunId,testKey:input.testKey}});
 const vaultIds=[...input.evidenceIds];
 for(const proof of evidence){const record=await registerEvidence(tx,userId,targetId,{kind:proof.ref.startsWith('requests/burp/')||proof.ref.startsWith('evidence/burp/')?'BURP_REFERENCE':'RESEARCH_EVIDENCE',sessionId:session.id,ref:proof.ref,description:proof.summary});vaultIds.push(record.id);}
 const revision=stream.revision+1;
 const event=await tx.researchCoverageEvent.create({data:{coverageId:stream.id,targetId,eventKey:input.eventKey,contentSha256,revision,state:input.state,action,result,evidence,performedAt:when,actorId:userId,source,sessionId:session.id,sessionReferenceId:session.id,hypothesisReferenceId:input.hypothesisId,hypothesisTestId:input.hypothesisTestId,findingReferenceId:input.findingId}});
 for(const id of [...new Set(vaultIds)])await linkEvidence(tx,userId,targetId,id,{entity:'coverage',id:event.id});
 await tx.researchCoverage.update({where:{id:stream.id},data:{revision,state:input.state}});
 return event;
}
export async function recordResearchCoverage(userId:string,targetId:string,input:unknown){return prisma.$transaction(tx=>record(tx,userId,targetId,input,'RESEARCHER'),{timeout:20000});}
export async function coverageHistory(userId:string,targetId:string,coverageId:string,before?:number){
 await prisma.$transaction(tx=>owned(tx,userId,targetId));
 return (await prisma.researchCoverageEvent.findMany({where:{coverageId,targetId,...(before?{revision:{lt:before}}:{})},orderBy:{revision:'desc'},take:50,include:{vaultEvidence:{select:{evidenceId:true}}}})).map(safeEvent);
}
/** Session creation uses the exact captured plan; neither provider selects another plan. */
export async function capturedCoverage(tx:Prisma.TransactionClient,userId:string,targetId:string,plan:ResearchPlanView|null){return coverageView(tx,userId,targetId,plan);}
