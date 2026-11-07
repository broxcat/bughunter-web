// One disposable, inference-free chain across the existing product boundaries.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const surface='https://app.example.test/objects/fixture';
export async function prepareReleasePlan({prisma,context,origin,target,recon}) {
  assert.equal(new URL(origin).hostname,'127.0.0.1');
  const assets=await context.request.get(origin+'/api/programs/'+target.programId+'/assets');assert.equal(assets.status(),200);
  const linked=await prisma.target.findUniqueOrThrow({where:{id:target.id}});
  assert(linked.scopeAssetId,'The normal Scope inventory must materialize the legacy host rule');
  await prisma.scanRun.update({where:{id:recon.id},data:{scopeAssetId:linked.scopeAssetId,outcome:'SUCCESS',finishedAt:new Date(),assessmentModeSnapshot:'BLACK_BOX'}});
  await prisma.reconArtifact.create({data:{scanRunId:recon.id,scopeAssetId:linked.scopeAssetId,kind:'endpoint',canonicalKey:surface,value:{url:surface,method:'GET',statusCode:200,contentType:'application/json'},scopeState:'IN_SCOPE',verification:'OBSERVED',sources:[{tool:'synthetic-release-fixture',sourceRef:'controlled:release-chain'}],firstSeenAt:new Date(),lastSeenAt:new Date()}});
  await prisma.reconArtifact.create({data:{scanRunId:recon.id,scopeAssetId:linked.scopeAssetId,kind:'parameter',canonicalKey:surface+':userId',value:{url:surface,name:'userId',method:'GET',statusCode:200},scopeState:'IN_SCOPE',verification:'OBSERVED',sources:[{tool:'synthetic-release-fixture',sourceRef:'controlled:release-parameter'}],firstSeenAt:new Date(),lastSeenAt:new Date()}});
  assert.equal(await prisma.finding.count({where:{targetId:target.id}}),0);
  const response=await context.request.get(origin+'/api/research-plans/current?targetId='+target.id);
  assert.equal(response.status(),200);
  const {plan}=await response.json();
  assert.equal(plan.scanRunId,recon.id);
  const item=plan.items.find(item=>item.status==='READY'&&item.surfaceRefs.some(ref=>ref.url===surface));
  assert(item,'Recorded Recon must produce an actionable objective: '+JSON.stringify(plan.items.map(item=>({status:item.status,surfaces:item.surfaceRefs,category:item.category}))));
  return {plan,item};
}

export async function recordReleaseCoverage({prisma,context,origin,target,research,objective}) {
  const captured=await prisma.researchSession.findUniqueOrThrow({where:{id:research.id}});
  assert.equal(captured.researchPlanId,objective.plan.id,'Research must capture the evidence-backed Plan');
  const hypothesis=await prisma.researchHypothesis.findFirstOrThrow({where:{sessionId:research.id,externalId:'H-003'}});
  assert.equal(hypothesis.planItemId,objective.item.id);
  const response=await context.request.post(origin+'/api/research-coverage/'+target.id,{data:{
    testKey:'m8-controlled-comparison',eventKey:randomUUID(),sessionId:research.id,planItemId:objective.item.id,
    surface,method:'GET',contextKey:'ANONYMOUS',state:'INTERESTING',expectedRevision:0,
    action:'Controlled local comparison represented by retained synthetic captures',result:'Technical hypothesis remains separate from human Finding review',
    evidence:[{ref:'evidence/positive.txt',summary:'Synthetic positive capture with separately retained control'}],
    performedAt:new Date().toISOString(),hypothesisId:hypothesis.id,
  }});
  assert.equal(response.status(),201,await response.text());
  const event=await prisma.researchCoverageEvent.findUniqueOrThrow({where:{id:(await response.json()).id},include:{vaultEvidence:true}});
  assert.equal(event.vaultEvidence.length,1);
  assert.equal(await prisma.finding.count({where:{targetId:target.id}}),0,'Plan/hypothesis/Coverage/Vault must never silently promote');
  const denied=await context.request.post(origin+`/api/research-sessions/${research.id}/hypotheses/${hypothesis.id}/finding-draft`,{data:{expectedRevision:hypothesis.revision,acknowledgeHumanReview:false}});
  assert.equal(denied.status(),400,'Promotion requires explicit human acknowledgement');
  return event.vaultEvidence[0].evidenceId;
}

export async function acceptReleaseRetest({prisma,context,origin,target,research,findingId,originalEvidenceId}) {
  const original=await prisma.evidenceRecord.findUniqueOrThrow({where:{id:originalEvidenceId}});
  const before=await prisma.finding.findUniqueOrThrow({where:{id:findingId}});
  assert.equal(before.lifecycle,'VALIDATED');
  const decide=async(state,expectedRevision)=>{
    const response=await context.request.post(origin+`/api/findings/${findingId}/lifecycle`,{data:{eventKey:randomUUID(),expectedRevision,state,reason:'Explicit synthetic release acceptance decision; preserve all original evidence'}});
    assert.equal(response.status(),201,await response.text());
    return response.json();
  };
  const requested=await decide('RETEST_REQUIRED',before.lifecycleRevision);
  const retest=await prisma.findingRetest.findFirstOrThrow({where:{findingId,result:null}});
  assert(retest.originalEvidenceIds.includes(originalEvidenceId));
  const result={retestId:retest.id,sessionId:research.id,outcome:'FIX_CONFIRMED',performedAt:new Date().toISOString(),conclusion:'Controlled post-fix fixture denies the original action and retains a valid negative control',evidenceIds:[originalEvidenceId]};
  assert.equal((await context.request.post(origin+`/api/findings/${findingId}/retest`,{data:result})).status(),400,'Reusing old evidence cannot certify a retest');
  const fresh=await context.request.post(origin+'/api/evidence/'+target.id,{data:{kind:'HTTP_REQUEST_RESPONSE',sessionId:research.id,description:'Distinct synthetic post-fix capture; no target request sent',observedAt:new Date().toISOString(),http:{method:'GET',url:surface,statusCode:403}}});
  assert.equal(fresh.status(),201,await fresh.text());
  const proof=await fresh.json();assert.notEqual(proof.id,originalEvidenceId);
  const recorded=await context.request.post(origin+`/api/findings/${findingId}/retest`,{data:{...result,performedAt:new Date().toISOString(),evidenceIds:[proof.id]}});
  assert.equal(recorded.status(),201,await recorded.text());
  await decide('CLOSED',requested.revision);
  assert.deepEqual(await prisma.evidenceRecord.findUniqueOrThrow({where:{id:originalEvidenceId}}),original,'Retest must preserve the original Vault record');
  const after=await prisma.finding.findUniqueOrThrow({where:{id:findingId}});
  assert.equal(after.evidence,before.evidence);assert.equal(after.createdAt.toISOString(),before.createdAt.toISOString());
  const history=await prisma.findingLifecycleEvent.findMany({where:{findingId},orderBy:{revision:'asc'}});
  assert.deepEqual(history.map(event=>event.state),['VALIDATING','VALIDATED','RETEST_REQUIRED','CLOSED']);
  assert.equal((await prisma.researchHypothesis.findFirstOrThrow({where:{sessionId:research.id,externalId:'H-004'}})).status,'REJECTED');
  return proof.id;
}
