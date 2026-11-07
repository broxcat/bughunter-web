import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='run_report_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma;
(db?describe:describe.skip)('Persisted run report and stored narrative (real SQL)',()=>{
 beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));},120000);
 afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
 it('preserves historical identity/policy/provenance, stored provider capture and read-only fallback under repeated exports',async()=>{
  const owner=await p.user.create({data:{email:randomUUID()+'@example.test'}}),program=await p.bountyProgram.create({data:{ownerId:owner.id,companyName:'Historical run',requiredUserAgent:'CURRENT-UA'}}),scope=await p.scope.create({data:{userId:owner.id,hostPattern:'original.fixture.test',status:'APPROVED'}}),asset=await p.scopeAsset.create({data:{programId:program.id,originalValue:'original.fixture.test',normalizedValue:'original.fixture.test',format:'DOMAIN',type:'WEB_APPLICATION'}}),target=await p.target.create({data:{userId:owner.id,programId:program.id,scopeId:scope.id,scopeAssetId:asset.id,host:'original.fixture.test'}}),run=await p.targetReconRun.create({data:{programId:program.id,status:'COMPLETED',outcome:'PARTIAL'}});
  const snapshot={assetId:asset.id,format:'DOMAIN',normalizedValue:'original.fixture.test'};
  const scan=await p.scanRun.create({data:{targetId:target.id,targetReconRunId:run.id,scopeAssetId:asset.id,type:'RECON',scopeAssetSnapshot:snapshot,status:'COMPLETED',outcome:'PARTIAL'}});
  const artifact=await p.reconArtifact.create({data:{scanRunId:scan.id,scopeAssetId:asset.id,kind:'endpoint',canonicalKey:'http',value:{url:'https://original.fixture.test/api',method:'GET',statusCode:403},scopeState:'IN_SCOPE',verification:'OBSERVED',sources:[{tool:'httpx',sourceRef:'source-captured',observedAt:'2026-11-01T00:00:00Z'}],firstSeenAt:new Date('2026-11-01'),lastSeenAt:new Date('2026-11-01')}});
  const {loadReconReportFacts}=await import('@/server/recon/reportFacts'),{buildReconReportModel}=await import('@/lib/reconReportModel'),{runNarrativeInput}=await import('@/lib/reconRunNarrative'),{validateReconReportV3}=await import('@/lib/reconReportV3'),{readRunNarrative}=await import('@/server/recon/runNarrative'),route=await import('@/app/api/recon/runs/[id]/report/route');
  const facts=await loadReconReportFacts(owner.id,run.id),input=runNarrativeInput(facts),alias=Object.entries(input.aliases).find(([,id])=>id===artifact.id)![0];
  const report=validateReconReportV3(JSON.stringify({title:'Recorded Recon',attackSurfaceSummary:'Evidence remains incomplete.',sections:[{category:'webSurface',entries:[{text:'Recorded endpoint requires manual review.',confidence:'observed',evidenceRefs:[alias]}]}],notableObservations:[],limitations:[],researchHandoff:[]}),input);
  await p.reconSummary.create({data:{programId:program.id,targetReconRunId:run.id,status:'READY',provider:'OPENROUTER',model:'captured-settings-model',endpoint:'http://127.0.0.1:1',promptVersion:'recon-report/3',sourceFingerprint:'fixture',input:JSON.parse(JSON.stringify(input)),content:JSON.parse(JSON.stringify(report))}});
  await p.scopeAsset.update({where:{id:asset.id},data:{normalizedValue:'current.fixture.test',active:false}});await p.bountyProgram.update({where:{id:program.id},data:{requiredUserAgent:'NEW-UA',outOfScope:['current-exclusion.test'],assessmentMode:'BLACK_BOX'}});
  mocks.auth.mockResolvedValue({user:{id:owner.id}});const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Network forbidden'));
  try{
   for(let i=0;i<3;i++){
    const current=await loadReconReportFacts(owner.id,run.id),model=buildReconReportModel(current),narrative=await readRunNarrative(owner.id,current,model);
    expect(model.authorization).toMatchObject({authorized:['original.fixture.test'],userAgent:null,excluded:[],exclusionsRecorded:false});expect(model.metadata.assessmentMode).toBe('not recorded');
    expect(model.provenance[0]).toMatchObject({id:artifact.id,scanRunId:scan.id,scopeAssetId:asset.id,runId:run.id,sources:[expect.stringContaining('source-captured')]});expect(narrative).toMatchObject({state:'AI_ASSISTED',provider:'OPENROUTER',model:'captured-settings-model'});
    const response=await route.GET(new Request('http://app.test/api/recon/runs/'+run.id+'/report'),{params:Promise.resolve({id:run.id})});expect(response.status).toBe(200);const md=await response.text();for(const text of ['NEW-UA','CURRENT-UA','current-exclusion','current.fixture.test'])expect(md).not.toContain(text);expect(md).toContain('AI-assisted evidence highlights');
   }
   expect(network).not.toHaveBeenCalled();expect(await p.reconSummary.count({where:{targetReconRunId:run.id}})).toBe(1);expect(await p.scanJobOutbox.count()).toBe(0);expect((await p.scanRun.findUniqueOrThrow({where:{id:scan.id}})).scopeAssetSnapshot).toEqual(snapshot);
   mocks.auth.mockResolvedValue({user:{id:'different-owner'}});expect((await route.GET(new Request('http://app.test/api/report'),{params:Promise.resolve({id:run.id})})).status).toBe(404);
   mocks.auth.mockResolvedValue(null);expect((await route.GET(new Request('http://app.test/api/report'),{params:Promise.resolve({id:run.id})})).status).toBe(401);
  }finally{network.mockRestore();}
 });
});
