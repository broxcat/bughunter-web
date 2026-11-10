import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='detailpages_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,userId:string,targetId:string,assetId:string,runId:string;
(db?describe:describe.skip)('Artifact and immutable snapshot detail pages',()=>{
 beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));},30000);
 beforeEach(async()=>{userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;mocks.auth.mockResolvedValue({user:{id:userId}});const program=await p.bountyProgram.create({data:{ownerId:userId,companyName:'Detail fixture',requiredUserAgent:'Fixture/1'}}),scope=await p.scope.create({data:{userId,hostPattern:'fixture.test',status:'APPROVED'}});assetId=(await p.scopeAsset.create({data:{programId:program.id,originalValue:'fixture.test',normalizedValue:'fixture.test',format:'DOMAIN',type:'WEB_APPLICATION'}})).id;targetId=(await p.target.create({data:{userId,programId:program.id,scopeId:scope.id,scopeAssetId:assetId,host:'fixture.test'}})).id;runId=(await p.scanRun.create({data:{targetId,scopeAssetId:assetId,type:'RECON',status:'COMPLETED'}})).id;});
 afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
 const artifact=async(query:string)=>{const {GET}=await import('@/app/api/scope-assets/[id]/artifacts/route');return GET(new Request(`http://app.example.test/api/scope-assets/${assetId}/artifacts?run=${runId}&${query}`),{params:Promise.resolve({id:assetId})});};
 it.each([0,1,25,51])('bounds host scan history over %i rows without transferring all Finding bodies',async count=>{
  await p.scanRun.delete({where:{id:runId}});
  await p.scanRun.createMany({data:Array.from({length:count},(_,n)=>({id:userId+'_'+String(n).padStart(3,'0'),targetId,type:'RECON',status:'COMPLETED',createdAt:new Date('2026-01-01')}))});
  await p.finding.create({data:{targetId,title:'Private Finding summary'}});
  const {GET}=await import('@/app/api/targets/[id]/route');
  for(const page of [1,2,3,999]){const response=await GET(new Request(`http://app.example.test/api/targets/${targetId}?scanPage=${page}`),{params:Promise.resolve({id:targetId})}),data=await response.json(),actual=Math.min(page,Math.max(1,Math.ceil(count/25)));expect(data.scanPage).toMatchObject({page:actual,total:count,pages:Math.max(1,Math.ceil(count/25))});expect(data.scanRuns).toHaveLength(Math.min(25,Math.max(0,count-(actual-1)*25)));expect(data.findingCount).toBe(1);expect(data.findings).toBeUndefined();}
  expect((await GET(new Request(`http://app.example.test/api/targets/${targetId}?scanPage=invalid`),{params:Promise.resolve({id:targetId})})).status).toBe(400);
 });
 it.each([0,1,100,201])('clamps artifact windows over %i immutable records',async count=>{
  await p.reconArtifact.createMany({data:Array.from({length:count},(_,n)=>({scanRunId:runId,scopeAssetId:assetId,kind:'endpoint',canonicalKey:String(n).padStart(4,'0'),value:{url:'https://fixture.test/'+n},scopeState:'IN_SCOPE',verification:'OBSERVED',sources:[],firstSeenAt:new Date('2026-01-01'),lastSeenAt:new Date('2026-01-01')}))});
  for(const page of [0,1,2,999]){const data=await(await artifact('page='+page)).json(),last=Math.max(0,Math.ceil(count/100)-1),actual=Math.min(page,last);expect(data).toMatchObject({total:count,page:actual});expect(data.rows).toHaveLength(Math.min(100,Math.max(0,count-actual*100)));}
  expect(await(await artifact('page=999&kind=technology')).json()).toMatchObject({total:0,page:0,rows:[]});
  for(const page of ['-1','invalid','1.5','10001'])expect((await artifact('page='+page)).status).toBe(400);
 });
 it('discloses recent windows without denying a known older owned run',async()=>{
  await p.scanRun.update({where:{id:runId},data:{artifactVersion:2}});
  const older=Array.from({length:50},(_,n)=>({id:userId+'_older_'+String(n).padStart(3,'0'),targetId,scopeAssetId:assetId,type:'RECON' as const,status:'COMPLETED' as const,artifactVersion:2,createdAt:new Date(Date.UTC(2026,0,1,0,0,n))}));await p.scanRun.createMany({data:older});
  const programId=(await p.target.findUniqueOrThrow({where:{id:targetId}})).programId!;
  const detail=await(await import('@/server/recon/intelligence')).loadAssetReconDetail(userId,programId,assetId,older[0].id);
  expect(detail).toMatchObject({historyLimit:30,historyTruncated:true,run:{id:older[0].id}});expect(detail.history).toHaveLength(30);
  const assets=await(await import('@/server/scopeAssets')).listScopeAssets(userId,programId);expect(assets[0]).toMatchObject({scanRunWindowLimit:20,scanRunsTruncated:true});expect(assets[0].scanRuns).toHaveLength(20);
  await p.targetReconRun.createMany({data:Array.from({length:11},()=>({programId,status:'COMPLETED'}))});const state=await(await import('@/server/recon/targetRuns')).targetReconState(userId,programId);expect(state).toMatchObject({runsLimit:10,runsTruncated:true});expect(state.runs).toHaveLength(10);
  const history=await(await import('@/server/recon/history')).reconHistory(userId,assetId);expect(history).toMatchObject({runWindowLimit:50,runWindowTruncated:true});expect(history.runs).toHaveLength(50);expect(history.notice).toContain('not complete run-history navigation');
 });

 it.each(['archived-assets','retiring-program'])('does not advertise Research readiness for %s',async state=>{
  const programId=(await p.target.findUniqueOrThrow({where:{id:targetId}})).programId!,parent=await p.targetReconRun.create({data:{programId,status:'COMPLETED',scopeMarkdown:'# Historical scope, not current authorization'}});
  await p.scanRun.update({where:{id:runId},data:{targetReconRunId:parent.id,scopeAssetSnapshot:{normalizedValue:'fixture.test',format:'DOMAIN',type:'WEB_APPLICATION',assetValue:'MEDIUM'}}});
  if(state==='archived-assets')await p.scopeAsset.update({where:{id:assetId},data:{active:false}});else await p.bountyProgram.update({where:{id:programId},data:{deletingAt:new Date()}});
  expect((await(await import('@/server/recon/targetRuns')).targetReconState(userId,programId)).researchReady).toBe(false);
 });

});
