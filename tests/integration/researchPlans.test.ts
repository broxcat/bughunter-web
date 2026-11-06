import { beforeAll,beforeEach,afterAll,describe,it,expect,vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const db=process.env.TEST_DATABASE_URL,schema='plans_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,s:typeof import('@/server/research/plans');
let userId:string,programId:string,targetId:string,assetId:string,runId:string;
const base='https://app.example.test/app/';
const snapshot={version:1,anonymous:{contextKey:'ANONYMOUS',mode:'ANONYMOUS'},contextLimit:4,contexts:['A','B'].map((letter,index)=>({credentialId:'PRIVATE_CREDENTIAL_'+letter,contextKey:'AUTH_'+letter,label:'PII Person '+letter,persona:index?'Manager':'User',purpose:index?'ACCOUNT_B':'ACCOUNT_A',sessionIdentityHash:'PRIVATE_IDENTITY_'+letter,sessionCheckId:'PRIVATE_CHECK_'+letter,sessionStatus:'VALID',checkedAt:'2026-11-04T10:00:00Z',expiresAt:null,validationUrl:base+'profile',ownedObjectUrl:null,eligibility:'PLANNED'}))};
async function artifact(url:string,kind='endpoint',scan=runId,extra:Record<string,unknown>={}){return p.reconArtifact.create({data:{scanRunId:scan,scopeAssetId:assetId,kind,canonicalKey:randomUUID(),value:{url,method:'GET',...extra},scopeState:'IN_SCOPE',verification:'OBSERVED',sources:[{tool:'fixture',sourceRef:scan,observedAt:'2026-11-04T10:00:00Z'}],firstSeenAt:new Date('2026-11-04T10:00:00Z'),lastSeenAt:new Date('2026-11-04T10:00:00Z')}});}
async function nextRun(){const a=await p.scopeAsset.findUniqueOrThrow({where:{id:assetId}});return p.scanRun.create({data:{targetId,scopeAssetId:assetId,type:'RECON',status:'COMPLETED',outcome:'SUCCESS',artifactVersion:2,scopeAssetSnapshot:{normalizedValue:a.normalizedValue,format:a.format,type:a.type,assetValue:a.assetValue},createdAt:new Date(Date.now()+1000),finishedAt:new Date(),assessmentModeSnapshot:'BLACK_BOX',authenticatedContextsSnapshot:snapshot}});}
(db?describe:describe.skip)('durable advisory Research Plans (real PostgreSQL, zero target/AI requests)',()=>{
  beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));s=await import('@/server/research/plans');});
  beforeEach(async()=>{
    await p.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');userId=(await p.user.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture'}})).id;
    programId=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Plan fixture',requiredUserAgent:'Plan-Fixture/1'}})).id;
    assetId=(await p.scopeAsset.create({data:{programId,originalValue:base,normalizedValue:base,format:'URL',type:'API',assetValue:'HIGH'}})).id;
    const scope=await p.scope.create({data:{userId,hostPattern:'app.example.test',status:'APPROVED'}});
    targetId=(await p.target.create({data:{userId,programId,scopeId:scope.id,scopeAssetId:assetId,host:'app.example.test',scheme:'https',active:false}})).id;
    runId=(await nextRun()).id;
    await artifact(base+'login','auth-surface');await artifact(base+'mfa','auth-surface');await artifact(base+'api/orders/1001');await artifact(base+'api/orders/1002');
    await artifact(base+'admin');
    for(const [index,key]of ['ANONYMOUS','AUTH_A','AUTH_B'].entries())await p.reconSurfaceObservation.create({data:{scanRunId:runId,scopeAssetId:assetId,contextKey:key,contextType:index?'AUTHENTICATED':'ANONYMOUS',canonicalKey:'GET:'+'a'.repeat(64),url:base+'admin',method:'GET',statusCode:[307,403,200][index],responseClass:['LOGIN_REDIRECT','DENIED','CONTENT'][index],observedAt:new Date('2026-11-04T10:00:00Z'),source:'fixture'}});
  });
  afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
  it('routes real artifact and context evidence without an AI default or network execution',async()=>{
    const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected target request'));
    try{const state=await s.researchPlanState(userId,targetId);expect(state.plan?.items.some(i=>i.category==='AUTHORIZATION'&&i.priority==='HIGH')).toBe(true);expect(state.plan?.items.some(i=>i.category==='AUTHENTICATION')).toBe(true);
      expect(state.plan?.items.flatMap(i=>i.evidenceRefs).some(r=>r.startsWith('ReconSurfaceObservation:'))).toBe(true);
      expect(JSON.stringify(state)).not.toMatch(/PRIVATE_|PII Person|sessionIdentityHash|cookiesCipher|Bearer |Authorization:/);
      expect(network).not.toHaveBeenCalled();expect(await p.aiProviderConfig.count()).toBe(0);expect(await p.finding.count()).toBe(0);expect(await p.researchHypothesis.count()).toBe(0);
    }finally{network.mockRestore();}
  });
  it('is idempotent under concurrent reads and enforces a single current plan',async()=>{const results=await Promise.all([s.researchPlanState(userId,targetId),s.researchPlanState(userId,targetId)]);expect(results[0].plan?.id).toBe(results[1].plan?.id);expect(await p.researchPlan.count({where:{targetId,status:'CURRENT'}})).toBe(1);});
  it('keeps a program-level advisory plan current against its child Recon without authorizing another host',async()=>{
    const scope=await p.scope.create({data:{userId,hostPattern:'*.example.test',status:'APPROVED'}});
    const programTarget=await p.target.create({data:{userId,programId,scopeId:scope.id,host:'program-context',contextOnly:true,active:false}});
    const state=await s.researchPlanState(userId,programTarget.id);expect(state.plan?.items.length).toBeGreaterThan(0);expect(state.reconCurrent).toBe(true);expect(state.plan?.status).toBe('CURRENT');
    expect(state.plan?.items.every(item=>item.surfaceRefs.every(surface=>surface.url.startsWith(base)))).toBe(true);
  });
  it('preserves Plan A and session A when new Recon generates Plan B, with stable objective identities',async()=>{
    const a=(await s.researchPlanState(userId,targetId)).plan!;const capturedA=await p.researchPlan.findUniqueOrThrow({where:{id:a.id}});
    const session=await p.researchSession.create({data:{userId,targetId,consoleTargetId:targetId,workspaceId:randomUUID(),targetHost:'app.example.test',programName:'Plan fixture',scopeMarkdown:'Fixture',status:'READY',researchPlanId:a.id}});
    const second=await nextRun();await artifact(base+'login','auth-surface',second.id);await artifact(base+'api/v3/export','api-surface',second.id);
    const b=await s.researchPlanState(userId,targetId);expect(b.plan?.id).not.toBe(a.id);expect(b.plan?.scanRunId).toBe(second.id);expect(b.newPlanAvailable).toBe(true);
    expect((await p.researchSession.findUniqueOrThrow({where:{id:session.id}})).researchPlanId).toBe(a.id);
    const old=await p.researchPlan.findUniqueOrThrow({where:{id:a.id}});expect(old.status).toBe('SUPERSEDED');expect(old.metadata).toEqual(capturedA.metadata);
    const captured=await p.$transaction(tx=>s.readCapturedResearchPlan(tx,a.id,userId,targetId));expect(captured.plan.id).toBe(a.id);expect(captured.markdown).toContain(a.id);
    expect(b.plan?.items.filter(i=>i.surfaceRefs.some(surface=>surface.url.endsWith('/login'))).some(i=>a.items.some(previous=>previous.stableKey===i.stableKey))).toBe(true);
    expect(b.plan?.items.some(i=>i.isNew&&i.surfaceRefs.some(surface=>surface.url.includes('/api/v3/export')))).toBe(true);
  });
  it('shows explicitly linked rejected hypotheses without changing the captured export or creating new hypotheses',async()=>{
    const a=(await s.researchPlanState(userId,targetId)).plan!,before=await p.$transaction(tx=>s.readCapturedResearchPlan(tx,a.id,userId,targetId));
    const session=await p.researchSession.create({data:{userId,targetId,workspaceId:randomUUID(),targetHost:'app.example.test',programName:'Plan fixture',scopeMarkdown:'Fixture',status:'READY',researchPlanId:a.id}});
    await p.researchHypothesis.create({data:{sessionId:session.id,planItemId:a.items[0].id,externalId:'H-001',title:'Earlier scoped test',status:'REJECTED',hypothesis:'Earlier hypothesis',evidenceFor:[],evidenceAgainst:[],nextTest:'Review new evidence first',expectedSignal:'Observed response',falsificationCondition:'Consistent denial',contentSha256:'a'.repeat(64)}});
    expect((await s.researchPlanDetails(userId,a.id)).items[0].hypotheses[0].status).toBe('REJECTED');
    expect((await p.$transaction(tx=>s.readCapturedResearchPlan(tx,a.id,userId,targetId))).contentSha256).toBe(before.contentSha256);expect(await p.researchHypothesis.count()).toBe(1);
  });
  it('uses identical runtime routing in White-box and never routes source hosts or external redirects',async()=>{
    const black=(await s.researchPlanState(userId,targetId)).plan!;
    await p.scanRun.update({where:{id:runId},data:{assessmentModeSnapshot:'WHITE_BOX',assessmentSourcesSnapshot:[{id:'metadata-only',kind:'GIT_REPOSITORY',locator:'https://internal-admin.example.local/repo',contentAvailable:false}]}});
    await artifact('https://outside.example.test/admin','endpoint',runId,{redirect:'https://foreign.example.test/app/admin'});
    const white=(await s.researchPlanState(userId,targetId)).plan!;expect(white.assessmentMode).toBe('BLACK_BOX');expect(white.authorizedSourceCount).toBe(0);expect(white.sourceAnalysisPerformed).toBe(false);
    expect(white.items.map(i=>i.stableKey)).toEqual(black.items.map(i=>i.stableKey));expect(JSON.stringify(white)).not.toMatch(/internal-admin|outside.example|foreign.example/);
  });
  it('suppresses explicitly excluded program categories with a recorded decision',async()=>{
    await p.bountyProgram.update({where:{id:programId},data:{nonQualifying:['Authorization']}});const state=await s.researchPlanState(userId,targetId);
    expect(state.plan?.items.filter(i=>i.status==='READY').some(i=>i.category==='AUTHORIZATION')).toBe(false);
    const row=await p.researchPlan.findUniqueOrThrow({where:{id:state.plan!.id}});expect(JSON.stringify(row.metadata)).toContain('NOT_APPLICABLE_BY_PROGRAM');
  });
  it('isolates owners and cascades only the deleted Target plans and items',async()=>{
    const plan=(await s.researchPlanState(userId,targetId)).plan!;const stranger=(await p.user.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture'}})).id;
    await expect(s.researchPlanDetails(stranger,plan.id)).rejects.toMatchObject({status:404});await expect(s.researchPlanState(stranger,targetId)).rejects.toMatchObject({status:404});
    const otherScope=await p.scope.create({data:{userId,hostPattern:'other.example.test',status:'APPROVED'}});
    const otherTarget=await p.target.create({data:{userId,programId,scopeId:otherScope.id,host:'other.example.test'}});
    const otherRun=await p.scanRun.create({data:{targetId:otherTarget.id,type:'RECON',status:'COMPLETED'}});
    const otherPlan=await p.researchPlan.create({data:{targetId:otherTarget.id,programId,scanRunId:otherRun.id,sourceFingerprint:'preserved-fixture',methodologyVersion:'research-plan/1',metadata:{}}});
    await p.target.delete({where:{id:targetId}});expect(await p.researchPlan.count({where:{id:plan.id}})).toBe(0);expect(await p.researchPlanItem.count({where:{planId:plan.id}})).toBe(0);
    expect(await p.researchPlan.findUnique({where:{id:otherPlan.id}})).not.toBeNull();
    expect(await p.user.count({where:{id:stranger}})).toBe(1);
  });
});
