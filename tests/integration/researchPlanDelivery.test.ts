import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, lstat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyReconDelivery } from '@/lib/research/reconDelivery';
import { hypothesesFixture, hypothesisFixture } from '../fixtures/hypotheses';

const db=process.env.TEST_DATABASE_URL,schema='plan_delivery_'+randomUUID().replaceAll('-','');
if(db){const url=new URL(db);url.searchParams.set('schema',schema);process.env.DATABASE_URL=url.toString();}
const control=vi.hoisted(()=>vi.fn());
let p:typeof import('@/lib/prisma').prisma,consoles:typeof import('@/server/research/consoleWorkspace'),sessions:typeof import('@/server/research/sessions'),snapshots:typeof import('@/server/research/reconSnapshots'),plans:typeof import('@/server/research/plans'),hypotheses:typeof import('@/server/research/hypotheses');
let root:string,userId:string,programId:string,targetId:string,assetId:string,runId:string,publicKey:string;
const source=(id:string)=>({tool:'fixture',sourceRef:'ScanRun:'+id,observedAt:new Date().toISOString()});
(db?describe:describe.skip)('Research plan capture and explicit delivery with PostgreSQL/filesystem (no provider CLI)',()=>{
  beforeAll(async()=>{
    execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));
    consoles=await import('@/server/research/consoleWorkspace');sessions=await import('@/server/research/sessions');snapshots=await import('@/server/research/reconSnapshots');plans=await import('@/server/research/plans');hypotheses=await import('@/server/research/hypotheses');
    root=await mkdtemp(join(tmpdir(),'research-plan-delivery-'));process.env.RESEARCH_CONSOLE_ROOT=join(root,'console');process.env.RESEARCH_WORKSPACE_ROOT=join(root,'zip');
    const pair=generateKeyPairSync('ed25519');publicKey=pair.publicKey.export({format:'pem',type:'spki'}).toString();process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE=join(root,'signer.pem');await writeFile(process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE,pair.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
    vi.stubGlobal('fetch',control);
  },30000);
  beforeEach(async()=>{
    control.mockReset();control.mockImplementation(async(_url,options)=>{const claims=verifyReconDelivery(options.headers.Authorization.slice(7),publicKey);return new Response(JSON.stringify({status:'STAGED',provider:claims.provider,contentSha256:claims.contentSha256}));});
    userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;
    programId=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Plan fixture',requiredUserAgent:'Plan-Test/1',scopeRules:['app.example.test']}})).id;
    const scope=await p.scope.create({data:{userId,hostPattern:'app.example.test',status:'APPROVED'}});
    assetId=(await p.scopeAsset.create({data:{programId,originalValue:'app.example.test',normalizedValue:'app.example.test',format:'SUBDOMAIN',type:'API',assetValue:'HIGH'}})).id;
    targetId=(await p.target.create({data:{userId,programId,scopeId:scope.id,scopeAssetId:assetId,host:'app.example.test',active:true}})).id;
    runId=await recon('/api/v1/login');
  });
  afterAll(async()=>{vi.unstubAllGlobals();if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}if(root)await rm(root,{force:true,recursive:true});});
  async function recon(path:string){
    const at=new Date(),asset=await p.scopeAsset.findUniqueOrThrow({where:{id:assetId}}),{assetSnapshot}=await import('@/server/scopeAssets');
    const run=await p.scanRun.create({data:{targetId,scopeAssetId:assetId,type:'RECON',status:'COMPLETED',outcome:'SUCCESS',finishedAt:at,artifactVersion:2,scopeAssetSnapshot:assetSnapshot(asset),assessmentModeSnapshot:'BLACK_BOX',assessmentSourcesSnapshot:[]}});
    await p.reconArtifact.create({data:{scanRunId:run.id,scopeAssetId:assetId,kind:'endpoint',canonicalKey:'GET:'+path,value:{url:'https://app.example.test'+path,method:'GET',statusCode:200},scopeState:'IN_SCOPE',verification:'OBSERVED',sources:[source(run.id)],firstSeenAt:at,lastSeenAt:at}});
    return run.id;
  }
  const consolePath=(workspaceId:string,name:string)=>join(process.env.RESEARCH_CONSOLE_ROOT!,workspaceId,name);
  it('captures structured Recon in the same initial read-only plan for ZIP and persistent consoles',async()=>{
    const zip=await sessions.createResearchSession(userId,targetId),console=await consoles.ensureTargetConsole(userId,targetId);
    expect(zip.researchPlanId).toBeTruthy();expect(console.session.researchPlanId).toBe(zip.researchPlanId);expect(console.session.reconScanRunId).toBe(runId);
    const content=await readFile(consolePath(console.session.workspaceId,'research/plan.json'),'utf8');
    expect(content).toBe(await readFile(join(process.env.RESEARCH_WORKSPACE_ROOT!,zip.workspaceId,'research/plan.json'),'utf8'));
    const plan=JSON.parse(content);expect(plan.scanRunId).toBe(runId);expect(plan.items.length).toBeGreaterThan(0);expect(plan.sourceAnalysisPerformed).toBe(false);
    expect((await lstat(consolePath(console.session.workspaceId,'research/plan.json'))).mode&0o777).toBe(0o440);
    expect(await p.researchHypothesis.count({where:{sessionId:console.session.id}})).toBe(0);expect(await p.finding.count({where:{targetId}})).toBe(0);expect(control).not.toHaveBeenCalled();
  });
  it('keeps initial session A fixed, publishes B only on explicit generation, and advances the used plan only after staging',async()=>{
    const {session}=await consoles.ensureTargetConsole(userId,targetId),first=await snapshots.generateReconSnapshot(userId,targetId),initial=await readFile(consolePath(session.workspaceId,'research/plan.json'),'utf8');
    const next=await recon('/api/v2/projects');const available=await plans.researchPlanState(userId,targetId);
    expect(available).toMatchObject({sessionPlanId:session.researchPlanId,newPlanAvailable:true,plan:{scanRunId:next}});
    await consoles.ensureTargetConsole(userId,targetId);expect(await readFile(consolePath(session.workspaceId,'research/plan.json'),'utf8')).toBe(initial);
    const second=await snapshots.generateReconSnapshot(userId,targetId),reference=second.snapshot!.context.researchPlan!;
    expect(reference.id).toBe(available.plan!.id);expect(reference.id).not.toBe(first.snapshot!.context.researchPlan!.id);
    expect((await plans.researchPlanState(userId,targetId)).sessionPlanId).toBe(session.researchPlanId);
    expect(await p.researchSession.findUniqueOrThrow({where:{id:session.id}})).toMatchObject({researchPlanId:session.researchPlanId});
    expect(await readFile(consolePath(session.workspaceId,'research/plan.json'),'utf8')).toBe(initial);
    const version=await readFile(consolePath(session.workspaceId,reference.jsonPath),'utf8');expect(JSON.parse(version).scanRunId).toBe(next);
    for(const provider of ['codex','claude'] as const){const receipt=await snapshots.transmitReconSnapshot(userId,targetId,second.snapshot!.id,provider);expect(receipt).toMatchObject({status:'STAGED',provider,snapshotId:second.snapshot!.id});}
    expect((await plans.researchPlanState(userId,targetId))).toMatchObject({sessionPlanId:reference.id,newPlanAvailable:false});
    expect(await readFile(consolePath(session.workspaceId,reference.jsonPath),'utf8')).toBe(version);
    expect(await p.researchHypothesis.count({where:{sessionId:session.id}})).toBe(0);expect(await p.finding.count({where:{targetId}})).toBe(0);
  });
  it('redelivers an earlier snapshot with its earlier plan, without recalculating it from current activity',async()=>{
    const {session}=await consoles.ensureTargetConsole(userId,targetId),first=await snapshots.generateReconSnapshot(userId,targetId),reference=first.snapshot!.context.researchPlan!,original=await readFile(consolePath(session.workspaceId,reference.jsonPath),'utf8');
    await recon('/api/v3/projects');const second=await snapshots.generateReconSnapshot(userId,targetId);await snapshots.transmitReconSnapshot(userId,targetId,second.snapshot!.id,'codex');
    await snapshots.transmitReconSnapshot(userId,targetId,first.snapshot!.id,'claude');expect(await readFile(consolePath(session.workspaceId,reference.jsonPath),'utf8')).toBe(original);
    expect((await plans.researchPlanState(userId,targetId)).sessionPlanId).toBe(reference.id);
  });
  it('does not retrofit missing initial plans into a historical console on renewal or explicit refresh',async()=>{
    const {session}=await consoles.ensureTargetConsole(userId,targetId);await p.researchSession.update({where:{id:session.id},data:{researchPlanId:null}});
    await rm(consolePath(session.workspaceId,'research'),{force:true,recursive:true});
    const renewed=await consoles.ensureTargetConsole(userId,targetId);expect(renewed.session.researchPlanId).toBeNull();await expect(access(consolePath(session.workspaceId,'research/plan.json'))).rejects.toThrow();
    const refreshed=await snapshots.generateReconSnapshot(userId,targetId);expect(refreshed.snapshot!.context.researchPlan).toBeTruthy();
    await expect(access(consolePath(session.workspaceId,'research/plan.json'))).rejects.toThrow();await expect(access(consolePath(session.workspaceId,'research/plan.md'))).rejects.toThrow();
    expect((await p.researchSession.findUniqueOrThrow({where:{id:session.id}})).researchPlanId).toBeNull();
  });
  it('accepts only explicitly linked initial or last-staged items and never binds a generated but undelivered plan',async()=>{
    const {session}=await consoles.ensureTargetConsole(userId,targetId),initial=await plans.researchPlanState(userId,targetId),a=initial.plan!.items[0];
    const file=consolePath(session.workspaceId,'findings/hypotheses.json');await writeFile(consolePath(session.workspaceId,'requests/observation.txt'),'Minimal captured fixture evidence.');
    const sync=async(planItemId:string|null)=>{await writeFile(file,JSON.stringify(hypothesesFixture(session.id,[hypothesisFixture({planItemId,evidenceFor:[{ref:'requests/observation.txt',summary:'Observed fixture evidence.'}]})])));return hypotheses.syncHypotheses(session.id,userId);};
    await sync(a.id);expect(await p.researchHypothesis.findFirstOrThrow({where:{sessionId:session.id}})).toMatchObject({planItemId:a.id});
    await recon('/api/v4/projects');const refreshed=await snapshots.generateReconSnapshot(userId,targetId),b=(await plans.researchPlanState(userId,targetId)).plan!.items[0];expect(b.id).not.toBe(a.id);
    await expect(sync(b.id)).rejects.toMatchObject({code:'INVALID_PLAN_ITEM'});await expect(sync('invented-plan-item')).rejects.toMatchObject({code:'INVALID_PLAN_ITEM'});
    await snapshots.transmitReconSnapshot(userId,targetId,refreshed.snapshot!.id,'claude');await sync(b.id);expect(await p.researchHypothesis.findFirstOrThrow({where:{sessionId:session.id}})).toMatchObject({planItemId:b.id});
    await sync(a.id);await sync(null);expect(await p.researchHypothesis.findFirstOrThrow({where:{sessionId:session.id}})).toMatchObject({planItemId:null});
    expect(await p.finding.count({where:{targetId}})).toBe(0);
  });
});
