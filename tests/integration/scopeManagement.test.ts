import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const mocks=vi.hoisted(()=>({auth:vi.fn(),settle:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/server/queue/scanCancellation',()=>({settleQueuedCancellations:mocks.settle}));
const db=process.env.TEST_DATABASE_URL,schema='scope_management_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,service:typeof import('@/server/scopeAssets'),route:typeof import('@/app/api/programs/[id]/assets/[assetId]/route');let userId:string,programId:string;
const req=(method:string,body?:unknown)=>new Request('http://app.example.test/api',{method,headers:{Origin:'http://app.example.test'},...(body?{body:JSON.stringify(body)}:{})});
const context=(assetId:string)=>({params:Promise.resolve({id:programId,assetId})});
(db?describe:describe.skip)('Milestone 2 explicit Scope identity and retirement',()=>{
 beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));service=await import('@/server/scopeAssets');route=await import('@/app/api/programs/[id]/assets/[assetId]/route');},30000);
 beforeEach(async()=>{userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;programId=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Scope management fixture',requiredUserAgent:'Fixture/1'}})).id;mocks.auth.mockResolvedValue({user:{id:userId}});mocks.settle.mockReset().mockResolvedValue(undefined);});
 afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
 const asset=(value='app.fixture.test')=>service.createScopeAsset(userId,programId,{value,assetValue:'MEDIUM'});
 it('rejects identity-changing Format PATCH even with old boundary confirmation and preserves the technical host',async()=>{
  const a=await asset('https://app.fixture.test/app'),{target}=await service.ensureAssetExecution(userId,programId,a.id);
  const response=await route.PATCH(req('PATCH',{format:'WILDCARD_DOMAIN',confirmBoundaryChange:true}),context(a.id));
  expect(response.status).toBe(409);expect(await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({active:true,normalizedValue:a.normalizedValue,format:'URL'});expect(await p.target.findUniqueOrThrow({where:{id:target.id}})).toMatchObject({host:target.host,scopeId:target.scopeId,scopeAssetId:a.id});
 });
 const replace=(a:{id:string;updatedAt:Date},value:string,extra={})=>route.POST(req('POST',{value,expectedUpdatedAt:a.updatedAt.toISOString(),confirmReplacement:true,...extra}),context(a.id));
 it('edits classification/priority with a current token; stale metadata conflicts and identity fields are rejected',async()=>{
  const a=await asset();const saved=await route.PATCH(req('PATCH',{type:'API',assetValue:'HIGH',expectedUpdatedAt:a.updatedAt.toISOString()}),context(a.id));expect(saved.status).toBe(200);
  expect((await route.PATCH(req('PATCH',{assetValue:'LOW',expectedUpdatedAt:a.updatedAt.toISOString()}),context(a.id))).status).toBe(409);
  for(const body of [{normalizedValue:'elsewhere.fixture.test'},{value:'elsewhere.fixture.test'},{type:'INVALID'},{format:'CIDR'}])expect((await route.PATCH(req('PATCH',body),context(a.id))).status).toBe(body.format?422:400);
  expect(await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({normalizedValue:a.normalizedValue,type:'API',assetValue:'HIGH'});
 });
 it('atomically replaces URL identity, preserves Target/Scan/Report/Research evidence, and rejects old authorization',async()=>{
  const a=await asset('https://app.fixture.test/app'),execution=await service.ensureAssetExecution(userId,programId,a.id);
  const captured=service.assetSnapshot(a),run=await p.scanRun.create({data:{targetId:execution.target.id,scopeAssetId:a.id,type:'RECON',status:'COMPLETED',scopeAssetSnapshot:captured}}),finding=await p.finding.create({data:{targetId:execution.target.id,scanRunId:run.id,title:'Historical fixture'}}),report=await p.report.create({data:{userId,targetId:execution.target.id,title:'Captured report',markdown:'# Captured history',items:{create:{findingId:finding.id}}}});
  const session=await p.researchSession.create({data:{userId,targetId:execution.target.id,consoleTargetId:execution.target.id,workspaceId:randomUUID(),status:'ARCHIVED',targetHost:execution.target.host,programName:'Fixture',scopeMarkdown:'# Original authorization',authorizationSnapshot:captured}}),snapshot=await p.researchReconSnapshot.create({data:{sessionId:session.id,sourceFingerprint:'fixture',contentSha256:'a'.repeat(64),summarySha256:'b'.repeat(64),context:{scopeAssets:[captured]},summary:{}}});
  const response=await replace(a,'https://app.fixture.test/admin');expect(response.status).toBe(201);const result=await response.json();expect(result.retiredAssetId).toBe(a.id);expect(result.asset.id).not.toBe(a.id);
  expect(await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({active:false,format:a.format,normalizedValue:a.normalizedValue});expect(await p.target.findUniqueOrThrow({where:{id:execution.target.id}})).toEqual(execution.target);
  expect((await p.scanRun.findUniqueOrThrow({where:{id:run.id}})).scopeAssetSnapshot).toEqual(captured);expect(await p.report.findUniqueOrThrow({where:{id:report.id}})).toEqual(report);expect(await p.researchSession.findUniqueOrThrow({where:{id:session.id}})).toEqual(session);expect(await p.researchReconSnapshot.findUniqueOrThrow({where:{id:snapshot.id}})).toEqual(snapshot);
  const newer=await service.ensureAssetExecution(userId,programId,result.asset.id);expect(newer.target.id).not.toBe(execution.target.id);expect(newer.target.scopeId).not.toBe(execution.target.scopeId);
  const {loadTargetExecution}=await import('@/server/execution');await expect(loadTargetExecution(execution.target.id,'RECON')).rejects.toThrow(/archived/);expect((await loadTargetExecution(newer.target.id,'RECON')).scopeAsset?.normalizedValue).toBe('https://app.fixture.test/admin');
  const {assertResearchTarget,researchTargetSelect}=await import('@/server/research/workspace');const current=await p.target.findUniqueOrThrow({where:{id:execution.target.id},select:researchTargetSelect});expect(()=>assertResearchTarget(current,userId)).toThrow();
 });
 it.each(['duplicate','same-identity','invalid','stale'])('failed replacement preserves usable original (%s)',async kind=>{
  const a=await asset();const {target}=await service.ensureAssetExecution(userId,programId,a.id);if(kind==='duplicate')await asset('other.fixture.test');
  const response=await replace(a,kind==='same-identity'?a.normalizedValue:kind==='invalid'?'not valid':'other.fixture.test',kind==='stale'?{expectedUpdatedAt:new Date(0).toISOString()}:{});expect(response.status).toBe(kind==='invalid'?400:409);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(true);expect((await(await import('@/server/execution')).loadTargetExecution(target.id,'RECON')).targetId).toBe(target.id);expect(mocks.settle).not.toHaveBeenCalled();
 });
 it('rolls back the new asset if retiring the original fails inside the transaction',async()=>{
  const a=await asset();await p.$executeRawUnsafe(`CREATE FUNCTION reject_retire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${a.id}' AND NEW.active = false THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);await p.$executeRawUnsafe('CREATE TRIGGER reject_retire BEFORE UPDATE ON "ScopeAsset" FOR EACH ROW EXECUTE FUNCTION reject_retire()');
  try{expect((await replace(a,'new.fixture.test')).status).toBe(503);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(true);expect(await p.scopeAsset.count({where:{programId,normalizedValue:'new.fixture.test'}})).toBe(0);}finally{await p.$executeRawUnsafe('DROP TRIGGER reject_retire ON "ScopeAsset"');await p.$executeRawUnsafe('DROP FUNCTION reject_retire()');}
 });
 it('allows one-for-one replacement at the existing active admission quota',async()=>{
  const a=await asset();await p.scopeAsset.createMany({data:Array.from({length:999},(_,n)=>({programId,originalValue:`h${n}.fixture.test`,normalizedValue:`h${n}.fixture.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION'}))});
  await expect(asset('overflow.fixture.test')).rejects.toMatchObject({status:429});expect((await replace(a,'replacement.fixture.test')).status).toBe(201);expect(await p.scopeAsset.count({where:{programId,active:true}})).toBe(1000);
 });
 it('serializes two replacement callers: one winner, one conflict, no extra authorization',async()=>{
  const a=await asset(),results=await Promise.all([replace(a,'one.fixture.test'),replace(a,'two.fixture.test')]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect(await p.scopeAsset.count({where:{programId,active:true}})).toBe(1);expect(await p.scopeAsset.count({where:{programId}})).toBe(2);
 });
 it('serializes retirement versus replacement without reviving the retired identity',async()=>{
  const a=await asset(),results=await Promise.all([replace(a,'replacement.fixture.test'),route.DELETE(req('DELETE',{expectedUpdatedAt:a.updatedAt.toISOString()}),context(a.id))]);expect([200,409]).toContain(results[1].status);expect([201,409]).toContain(results[0].status);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(false);expect(await p.scopeAsset.count({where:{programId,active:true}})).toBe(results[0].status===201?1:0);
 });
 it('retirement cancels only current work, blocks captured execution and retains history; retry is safe',async()=>{
  const a=await asset(),{target}=await service.ensureAssetExecution(userId,programId,a.id),{loadTargetExecution,withTargetExecution}=await import('@/server/execution'),execution=await loadTargetExecution(target.id,'RECON');
  const queued=await p.scanRun.create({data:{targetId:target.id,scopeAssetId:a.id,type:'RECON'}}),completed=await p.scanRun.create({data:{targetId:target.id,scopeAssetId:a.id,type:'RECON',status:'COMPLETED',scopeAssetSnapshot:service.assetSnapshot(a)}});
  expect((await route.DELETE(req('DELETE',{expectedUpdatedAt:a.updatedAt.toISOString()}),context(a.id))).status).toBe(200);expect((await p.scanRun.findUniqueOrThrow({where:{id:queued.id}})).cancelRequestedAt).not.toBeNull();expect(await p.scanRun.findUniqueOrThrow({where:{id:completed.id}})).toEqual(completed);
  const {assertLiveAsset}=await import('@/server/recon/assetPipeline');await expect(withTargetExecution(execution,assertLiveAsset)).rejects.toThrow();await expect(loadTargetExecution(target.id,'RECON')).rejects.toThrow();await service.listScopeAssets(userId,programId);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(false);
  expect((await route.DELETE(req('DELETE'),context(a.id))).status).toBe(200);
 });
 it('reports committed replacement separately from retryable post-commit cleanup failure',async()=>{
  const a=await asset();mocks.settle.mockRejectedValueOnce(new Error('synthetic unavailable transport'));
  const response=await replace(a,'replacement.fixture.test');expect(response.status).toBe(201);const body=await response.json();expect(body.cleanupWarning).toContain('authorization revoked');expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(false);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:body.asset.id}})).active).toBe(true);
  expect((await route.DELETE(req('DELETE'),context(a.id))).status).toBe(200);
 });
 it('rejects another owner, missing/deleting parent and anonymous mutation',async()=>{
  const a=await asset();mocks.auth.mockResolvedValue({user:{id:'foreign'}});for(const method of ['PATCH','POST','DELETE'] as const){const body=method==='POST'?{value:'other.fixture.test',confirmReplacement:true,expectedUpdatedAt:a.updatedAt.toISOString()}:method==='PATCH'?{type:'API'}:undefined;expect((await route[method](req(method,body),context(a.id))).status).toBe(404);}
  mocks.auth.mockResolvedValue(null);expect((await replace(a,'other.fixture.test')).status).toBe(401);mocks.auth.mockResolvedValue({user:{id:userId}});expect((await route.DELETE(req('DELETE'),context('missing'))).status).toBe(404);
  await p.bountyProgram.update({where:{id:programId},data:{deletingAt:new Date()}});expect((await replace(a,'other.fixture.test')).status).toBe(404);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(true);
 });
 it('exclusions use current server policy, support removal and reject stale settings',async()=>{
  const a=await asset(),{target}=await service.ensureAssetExecution(userId,programId,a.id),{PATCH}=await import('@/app/api/programs/[id]/route'),program=await p.bountyProgram.findUniqueOrThrow({where:{id:programId}}),params={params:Promise.resolve({id:programId})};
  expect((await PATCH(req('PATCH',{outOfScope:['app.fixture.test'],expectedUpdatedAt:program.updatedAt.toISOString()}),params)).status).toBe(200);await expect((await import('@/server/execution')).loadTargetExecution(target.id,'RECON')).rejects.toThrow(/out of scope/);
  expect((await PATCH(req('PATCH',{outOfScope:[],expectedUpdatedAt:program.updatedAt.toISOString()}),params)).status).toBe(409);const current=await p.bountyProgram.findUniqueOrThrow({where:{id:programId}});expect((await PATCH(req('PATCH',{outOfScope:[],expectedUpdatedAt:current.updatedAt.toISOString()}),params)).status).toBe(200);await expect((await import('@/server/execution')).loadTargetExecution(target.id,'RECON')).resolves.toMatchObject({targetId:target.id});
 });

 it('creates a manual Format replacement without carrying preview-only fields into Prisma',async()=>{
  const a=await asset('example.test'),result=await replace(a,'example.test',{format:'WILDCARD_DOMAIN'});expect(result.status).toBe(201);const body=await result.json();expect(body.asset).toMatchObject({normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',formatSource:'MANUAL'});expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(false);
 });
 it('reauthorizes retained identities only with the original Format and leaves historical Target identity intact',async()=>{
  const a=await asset('example.test'),{target}=await service.ensureAssetExecution(userId,programId,a.id);await service.editScopeAsset(userId,programId,a.id,null);
  await expect(service.createScopeAsset(userId,programId,{value:'example.test',format:'SUBDOMAIN',assetValue:'HIGH'})).rejects.toMatchObject({status:409});expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(false);
  const restored=await asset('example.test');expect(restored.id).toBe(a.id);expect(restored.format).toBe('DOMAIN');expect(await p.target.findUniqueOrThrow({where:{id:target.id}})).toEqual(target);
 });

 it.each(['REMOVE','EDIT'] as const)('legacy host %s retires bound Scope authorization without mutating the old technical identity',async action=>{
  const a=await asset(),scope=await p.scope.create({data:{userId,hostPattern:a.normalizedValue,status:'APPROVED'}}),target=await p.target.create({data:{userId,programId,scopeId:scope.id,scopeAssetId:a.id,host:a.normalizedValue,active:true}}),scan=await p.scanRun.create({data:{targetId:target.id,scopeAssetId:a.id,type:'RECON',status:'COMPLETED',scopeAssetSnapshot:service.assetSnapshot(a)}});
  const result=await(await import('@/server/programHosts')).mutateHost(userId,programId,action,{hostId:target.id,...(action==='EDIT'?{host:'new.fixture.test'}:{})});
  expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(false);expect(await p.target.findUniqueOrThrow({where:{id:target.id}})).toMatchObject({host:target.host,scopeId:target.scopeId,scopeAssetId:a.id,active:false});expect(await p.scanRun.findUniqueOrThrow({where:{id:scan.id}})).toEqual(scan);await expect((await import('@/server/execution')).loadTargetExecution(target.id,'RECON')).rejects.toThrow();
  if(action==='EDIT'){expect(result.id).not.toBe(target.id);expect(result.host).toBe('new.fixture.test');}else expect(result.id).toBe(target.id);
 });

 it('a failed legacy host replacement preserves original asset and execution authorization',async()=>{
  const a=await asset(),scope=await p.scope.create({data:{userId,hostPattern:a.normalizedValue,status:'APPROVED'}}),target=await p.target.create({data:{userId,programId,scopeId:scope.id,scopeAssetId:a.id,host:a.normalizedValue}});await p.target.create({data:{userId,programId,scopeId:scope.id,host:'duplicate.fixture.test'}});
  await expect((await import('@/server/programHosts')).mutateHost(userId,programId,'EDIT',{hostId:target.id,host:'duplicate.fixture.test'})).rejects.toMatchObject({status:409});expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(true);expect(await p.target.findUniqueOrThrow({where:{id:target.id}})).toEqual(target);
 });
 it('a cleanup failure explicitly reports committed retirement, and repeat cleanup succeeds',async()=>{
  const a=await asset();mocks.settle.mockRejectedValueOnce(new Error('fixture transport unavailable'));const response=await route.DELETE(req('DELETE'),context(a.id));expect(response.status).toBe(503);expect((await response.json()).error).toContain('authorization retired');expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(false);expect((await route.DELETE(req('DELETE'),context(a.id))).status).toBe(200);
 });

 it('a stale retired-view cleanup token cannot revoke an explicitly reauthorized identity',async()=>{
  const a=await asset(),retired=await service.editScopeAsset(userId,programId,a.id,null);const restored=await asset();expect(restored.id).toBe(a.id);
  expect((await route.DELETE(req('DELETE',{expectedUpdatedAt:retired.updatedAt.toISOString()}),context(a.id))).status).toBe(409);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).active).toBe(true);expect(mocks.settle).toHaveBeenCalledTimes(1);
 });

});
