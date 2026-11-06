import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {coverageRecordSchema} from '@/lib/research/coverage';
const db=process.env.TEST_DATABASE_URL,schema='coverage_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,service:typeof import('@/server/research/coverage'),workspace:typeof import('@/server/research/workspace'),root:string,userId:string,targetId:string,sessionId:string,itemId:string,planId:string,scopeId:string,folder:string;
const surface='https://app.example.test/app/login';
const body=(extra:Record<string,unknown>={})=>coverageRecordSchema.parse({testKey:'access-check',eventKey:randomUUID(),sessionId,planItemId:itemId,surface,method:'GET',contextKey:'ANONYMOUS',state:'COVERED_NO_ISSUE_OBSERVED',expectedRevision:0,action:'Compared runtime access',result:'403; negative result retained',evidence:[{ref:'requests/control.json',summary:'Cookie: PRIVATE_COOKIE\nStatus 403'}],performedAt:new Date().toISOString(),...extra});
(db?describe:describe.skip)('persistent Research Coverage with real PostgreSQL and guarded workspace files',()=>{
 beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));service=await import('@/server/research/coverage');workspace=await import('@/server/research/workspace');root=await mkdtemp(join(tmpdir(),'coverage-db-'));process.env.RESEARCH_CONSOLE_ROOT=root;},120000);
 beforeEach(async()=>{
  userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;
  const program=await p.bountyProgram.create({data:{ownerId:userId,companyName:'Coverage fixture',requiredUserAgent:'Coverage/1'}});
  const scope=await p.scope.create({data:{userId,hostPattern:'app.example.test',status:'APPROVED'}});scopeId=scope.id;
  const asset=await p.scopeAsset.create({data:{programId:program.id,originalValue:'https://app.example.test/app/',normalizedValue:'https://app.example.test/app/',format:'URL',type:'API'}});
  const target=await p.target.create({data:{userId,programId:program.id,scopeId,scopeAssetId:asset.id,host:'app.example.test',scheme:'https'}});targetId=target.id;
  const scan=await p.scanRun.create({data:{targetId,type:'RECON',status:'COMPLETED',assessmentModeSnapshot:'BLACK_BOX'}});
  const plan=await p.researchPlan.create({data:{targetId,programId:program.id,scopeAssetId:asset.id,scanRunId:scan.id,sourceFingerprint:randomUUID(),methodologyVersion:'research-plan/1',assessmentMode:'BLACK_BOX',metadata:{}}});planId=plan.id;
  const item=await p.researchPlanItem.create({data:{planId,stableKey:'authorization-login',category:'AUTHORIZATION',priority:'HIGH',title:'Login authorization',objective:'Compare recorded access',rationale:'Observed runtime surface',methodology:'Minimal controlled comparison',surfaceRefs:[{url:surface,method:'GET'}],evidenceRefs:[],contextRefs:[{contextKey:'AUTH_A',label:'User A'},{contextKey:'AUTH_B',label:'User B'}],runtimeSignals:[],sourceSignals:[],sourceEvidenceRefs:[],score:50,evidenceStrength:3}});itemId=item.id;
  const selected=await p.target.findUniqueOrThrow({where:{id:targetId},select:workspace.researchTargetSelect});
  const {targetWorkspaceId}=await import('@/lib/research/terminal');const workspaceId=targetWorkspaceId(targetId);
  const session=await p.researchSession.create({data:{userId,targetId,consoleTargetId:targetId,workspaceId,researchPlanId:planId,status:'READY',targetHost:target.host,programName:program.companyName,scopeMarkdown:'Scoped fixture',authorizationSnapshot:workspace.researchAuthorizationSnapshot(selected)}});sessionId=session.id;
  const {consoleBundle,writeConsoleWorkspace}=await import('@/server/research/consoleWorkspace');await writeConsoleWorkspace(root,targetId,consoleBundle(selected,null,[],session));folder=join(root,workspaceId);await writeFile(join(folder,'requests/control.json'),'Synthetic redacted evidence',{mode:0o600});
 });
 afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}if(root)await rm(root,{recursive:true,force:true});});
 it('keeps negative tests, method and authentication comparisons separate without creating Findings',async()=>{
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No network expected'));
  try{await service.recordResearchCoverage(userId,targetId,body());await service.recordResearchCoverage(userId,targetId,body({contextKey:'AUTH_A',comparisonKey:'AUTH_B'}));await service.recordResearchCoverage(userId,targetId,body({method:'PATCH',state:'NOT_TESTED',evidence:[],result:'Not tested yet'}));
   const view=await service.researchCoverageState(userId,targetId);expect(view.entries).toHaveLength(3);expect(view.counts.COVERED_NO_ISSUE_OBSERVED).toBe(2);expect(view.counts.NOT_TESTED).toBe(1);expect(view.entries.some(e=>e.method==='PATCH'&&e.state==='NOT_TESTED')).toBe(true);expect(JSON.stringify(view)).not.toContain('PRIVATE_COOKIE');expect(view.entries.flatMap(e=>e.events).some(e=>e.result.includes('negative result'))).toBe(true);
   expect(await p.finding.count({where:{targetId}})).toBe(0);expect(await p.researchHypothesis.count({where:{sessionId}})).toBe(0);expect(network).not.toHaveBeenCalled();
  }finally{network.mockRestore();}
 });
 it('is idempotent, rejects stale writes, and appends rather than replacing negative results',async()=>{
  const first=body();await service.recordResearchCoverage(userId,targetId,first);await service.recordResearchCoverage(userId,targetId,first);
  await expect(service.recordResearchCoverage(userId,targetId,{...first,result:'Changed replay'})).rejects.toMatchObject({status:409});
  const concurrent=await Promise.allSettled([service.recordResearchCoverage(userId,targetId,body({expectedRevision:1,state:'NEEDS_RETEST'})),service.recordResearchCoverage(userId,targetId,body({expectedRevision:1,state:'INTERESTING'}))]);expect(concurrent.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const row=await p.researchCoverage.findFirstOrThrow({where:{targetId}});expect(row.revision).toBe(2);const history=await service.coverageHistory(userId,targetId,row.id,2);expect(history[0].state).toBe('COVERED_NO_ISSUE_OBSERVED');expect(history[0].result).toContain('negative result');expect(await p.researchCoverageEvent.count({where:{targetId}})).toBe(2);
 });
 it('survives session archival and deletion, preserving the immutable session reference',async()=>{
  await service.recordResearchCoverage(userId,targetId,body());await p.researchSession.update({where:{id:sessionId},data:{status:'ARCHIVED'}});
  expect((await service.researchCoverageState(userId,targetId)).entries).toHaveLength(1);await expect(service.recordResearchCoverage(userId,targetId,body())).rejects.toMatchObject({status:409});
  await p.researchSession.delete({where:{id:sessionId}});const event=await p.researchCoverageEvent.findFirstOrThrow({where:{targetId}});expect(event.sessionId).toBeNull();expect(event.sessionReferenceId).toBe(sessionId);expect((await service.coverageHistory(userId,targetId,event.coverageId))[0].result).toContain('negative result');
 });
 it('publishes one shared read-only context for agents, retaining immutable earlier snapshots',async()=>{
  await service.recordResearchCoverage(userId,targetId,body());const a=await service.publishResearchCoverage(userId,targetId);
  expect((await lstat(join(folder,a.jsonPath))).mode&0o222).toBe(0);const before=await readFile(join(folder,a.jsonPath),'utf8');expect(before).toContain('COVERED_NO_ISSUE_OBSERVED');expect(await readFile(join(folder,a.markdownPath),'utf8')).toContain('Do not repeat');
  await service.recordResearchCoverage(userId,targetId,body({expectedRevision:1,state:'NEEDS_RETEST'}));const b=await service.publishResearchCoverage(userId,targetId);expect(b.sha256).not.toBe(a.sha256);expect(await readFile(join(folder,a.jsonPath),'utf8')).toBe(before);expect(JSON.parse(await readFile(join(folder,'research/coverage-current.json'),'utf8')).sha256).toBe(b.sha256);
 });
 it('imports explicit structured tests only and checks session, references and symlink isolation',async()=>{
  await writeFile(join(folder,'findings/coverage-events.json'),JSON.stringify({version:1,sessionId,events:[body()]}));await service.syncResearchCoverage(userId,targetId,sessionId);await service.syncResearchCoverage(userId,targetId,sessionId);expect(await p.researchCoverageEvent.count({where:{targetId}})).toBe(1);
  await writeFile(join(folder,'findings/coverage-events.json'),'terminal said GET was safe');await expect(service.syncResearchCoverage(userId,targetId,sessionId)).rejects.toThrow();
  await symlink('/etc/passwd',join(folder,'requests/escape.txt'));await expect(service.recordResearchCoverage(userId,targetId,body({evidence:[{ref:'requests/escape.txt',summary:'Unsafe'}]}))).rejects.toThrow();
 });
 it('enforces ownership, scope/path revocation, objective/context binding and real Finding links',async()=>{
  const stranger=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;
  await expect(service.researchCoverageState(stranger,targetId)).rejects.toMatchObject({status:404});await expect(service.recordResearchCoverage(stranger,targetId,body())).rejects.toMatchObject({status:404});
  for(const extra of [{surface:'https://internal-admin.example.local/app/login'},{surface:'https://app.example.test/outside'},{contextKey:'INVENTED'},{state:'FINDING',findingId:'nonexistent'},{state:'HYPOTHESIS_OPEN',hypothesisId:'nonexistent'}])await expect(service.recordResearchCoverage(userId,targetId,body(extra))).rejects.toThrow();
  await p.scope.update({where:{id:scopeId},data:{status:'REVOKED'}});await expect(service.recordResearchCoverage(userId,targetId,body())).rejects.toThrow();expect(await p.researchCoverageEvent.count({where:{targetId}})).toBe(0);
 });
 it('keeps saved negative history readable after scope revocation while denying further tests',async()=>{
  await service.recordResearchCoverage(userId,targetId,body());await p.scope.update({where:{id:scopeId},data:{status:'REVOKED'}});
  const view=await service.researchCoverageState(userId,targetId);expect(view.entries).toHaveLength(1);expect(view.sessionId).toBeNull();expect(view.notice).toContain('read-only');await expect(service.recordResearchCoverage(userId,targetId,body({expectedRevision:1}))).rejects.toThrow();
 });

 it('retains objective and Scope Asset reference identities if their live FK is removed',async()=>{
  await service.recordResearchCoverage(userId,targetId,body());const before=await p.researchCoverage.findFirstOrThrow({where:{targetId}});
  await p.researchPlan.delete({where:{id:planId}});const after=await p.researchCoverage.findUniqueOrThrow({where:{id:before.id}});
  expect(after.planItemId).toBeNull();expect(after.planItemReferenceId).toBe(itemId);expect(after.scopeAssetReferenceId).toBe(before.scopeAssetId);expect(await p.researchCoverageEvent.count({where:{targetId}})).toBe(1);
 });

});
