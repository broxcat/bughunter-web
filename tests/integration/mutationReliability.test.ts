import type {Prisma} from '@prisma/client';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='mutation_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,userId:string;
const request=(path:string,method:string,body?:unknown,origin='http://app.example.test')=>new NextRequest('http://app.example.test'+path,{method,headers:{'Content-Type':'application/json',Origin:origin},...(body!==undefined?{body:JSON.stringify(body)}:{})});
(db?describe:describe.skip)('Mutation admission and concurrent removal',()=>{
 beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));},30000);
 beforeEach(async()=>{userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;mocks.auth.mockResolvedValue({user:{id:userId}});});
 afterAll(async()=>{vi.restoreAllMocks();if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
 it('rejects an explicit foreign Origin before creating a Program',async()=>{
  const {POST}=await import('@/app/api/programs/route');
  const r=await POST(request('/api/programs','POST',{companyName:'Foreign origin fixture',requiredUserAgent:'Fixture/1'},'http://untrusted.example.test'));
  expect(r.status).toBe(403);expect(await p.bountyProgram.count({where:{ownerId:userId}})).toBe(0);
 });
 it('rejects foreign Origin before approving an existing pending Scope',async()=>{
  const scope=await p.scope.create({data:{userId,hostPattern:'fixture.test'}}),{POST}=await import('@/app/api/scopes/[id]/approve/route');
  const r=await POST(request('/api/scopes/'+scope.id+'/approve','POST',undefined,'http://untrusted.example.test'),{params:Promise.resolve({id:scope.id})});
  expect(r.status).toBe(403);expect((await p.scope.findUniqueOrThrow({where:{id:scope.id}})).status).toBe('PENDING');
 });
 it('returns 404 when a Finding disappears between the owned read and classification update',async()=>{
  const scope=await p.scope.create({data:{userId,hostPattern:'fixture.test'}}),target=await p.target.create({data:{userId,scopeId:scope.id,host:'fixture.test'}}),finding=await p.finding.create({data:{targetId:target.id,title:'Concurrent deletion'}});
  const original=p.finding.findFirst.bind(p.finding);
  const spy=vi.spyOn(p.finding,'findFirst').mockImplementationOnce(args=>original(args).then(async row=>{await p.finding.delete({where:{id:finding.id}});return row;}) as unknown as ReturnType<typeof p.finding.findFirst>);
  try{const {PATCH}=await import('@/app/api/findings/[id]/route');const r=await PATCH(request('/api/findings/'+finding.id,'PATCH',{impact:'Explicit impact'}),{params:Promise.resolve({id:finding.id})});expect(r.status).toBe(404);}finally{spy.mockRestore();}
 });
 it.each(['metadata','approval'])('returns404 when Scope %s is concurrently removed',async kind=>{
  const scope=await p.scope.create({data:{userId,hostPattern:'fixture.test'}}),original=p.scope.update.bind(p.scope);
  const spy=vi.spyOn(p.scope,'update').mockImplementationOnce(args=>p.scope.delete({where:{id:scope.id}}).then(()=>original(args)) as unknown as ReturnType<typeof p.scope.update>);
  try{const context={params:Promise.resolve({id:scope.id})};const r=kind==='metadata'?await(await import('@/app/api/scopes/[id]/route')).PATCH(request('/api/scopes/'+scope.id,'PATCH',{rulesOfEngagement:'Metadata'}),context):await(await import('@/app/api/scopes/[id]/approve/route')).POST(request('/api/scopes/'+scope.id+'/approve','POST'),context);expect(r.status).toBe(404);}finally{spy.mockRestore();}
 });

 it('returns404 for a credential removed immediately before its metadata update',async()=>{
  const scope=await p.scope.create({data:{userId,hostPattern:'fixture.test'}}),target=await p.target.create({data:{userId,scopeId:scope.id,host:'fixture.test'}}),credential=await p.targetCredential.create({data:{targetId:target.id,label:'Fixture'}}),original=p.targetCredential.update.bind(p.targetCredential);
  const spy=vi.spyOn(p.targetCredential,'update').mockImplementationOnce(args=>p.targetCredential.delete({where:{id:credential.id}}).then(()=>original(args)) as unknown as ReturnType<typeof p.targetCredential.update>);
  try{const {PATCH}=await import('@/app/api/targets/[id]/credentials/route');expect((await PATCH(request('/api/targets/'+target.id+'/credentials','PATCH',{credentialId:credential.id,purpose:'ACCOUNT_A'}),{params:Promise.resolve({id:target.id})})).status).toBe(404);}finally{spy.mockRestore();}
 });
 it.each(['target','run'])('handles a Finding reference removed immediately before insert: %s',async kind=>{
  const scope=await p.scope.create({data:{userId,hostPattern:'fixture.test'}}),target=await p.target.create({data:{userId,scopeId:scope.id,host:'fixture.test'}}),run=await p.scanRun.create({data:{targetId:target.id,type:'RECON',status:'COMPLETED'}}),original=p.finding.create.bind(p.finding);
  const spy=vi.spyOn(p.finding,'create').mockImplementationOnce(args=>(kind==='target'?p.target.delete({where:{id:target.id}}):p.scanRun.delete({where:{id:run.id}})).then(()=>original(args)) as unknown as ReturnType<typeof p.finding.create>);
  try{const {POST}=await import('@/app/api/findings/route');expect((await POST(request('/api/findings','POST',{targetId:target.id,scanRunId:run.id,title:'Concurrent parent removal'}))).status).toBe(kind==='target'?404:400);}finally{spy.mockRestore();}
 });
 it('handles Scope removal immediately before technical Target creation',async()=>{
  const scope=await p.scope.create({data:{userId,hostPattern:'fixture.test',status:'APPROVED'}}),original=p.target.create.bind(p.target);
  const spy=vi.spyOn(p.target,'create').mockImplementationOnce(args=>p.scope.delete({where:{id:scope.id}}).then(()=>original(args)) as unknown as ReturnType<typeof p.target.create>);
  try{const {POST}=await import('@/app/api/targets/route');expect((await POST(request('/api/targets','POST',{scopeId:scope.id,host:'fixture.test'}))).status).toBe(400);}finally{spy.mockRestore();}
 });
 it('handles Target removal immediately before credential creation without exposing secret input',async()=>{
  const scope=await p.scope.create({data:{userId,hostPattern:'fixture.test'}}),target=await p.target.create({data:{userId,scopeId:scope.id,host:'fixture.test'}}),original=p.targetCredential.create.bind(p.targetCredential),previous=process.env.CREDENTIALS_ENCRYPTION_KEY;process.env.CREDENTIALS_ENCRYPTION_KEY='ab'.repeat(32);
  const spy=vi.spyOn(p.targetCredential,'create').mockImplementationOnce(args=>p.target.delete({where:{id:target.id}}).then(()=>original(args)) as unknown as ReturnType<typeof p.targetCredential.create>);
  try{const {POST}=await import('@/app/api/targets/[id]/credentials/route');const response=await POST(request('/api/targets/'+target.id+'/credentials','POST',{label:'Fixture',bearerToken:'SYNTHETIC_PRIVATE_TOKEN'}),{params:Promise.resolve({id:target.id})});expect(response.status).toBe(404);expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE_TOKEN');}finally{spy.mockRestore();if(previous===undefined)delete process.env.CREDENTIALS_ENCRYPTION_KEY;else process.env.CREDENTIALS_ENCRYPTION_KEY=previous;}
 });

 it.each(['legacy.fixture.test','*.legacy.fixture.test'])('assigns a legacy host to only one Program when different Program locks race (%s)',async host=>{
  const programs=await Promise.all(['A','B'].map(companyName=>p.bountyProgram.create({data:{ownerId:userId,companyName,requiredUserAgent:'Fixture/1'}}))),scope=await p.scope.create({data:{userId,hostPattern:host,status:'APPROVED'}}),legacy=await p.target.create({data:{userId,scopeId:scope.id,host}}),scan=await p.scanRun.create({data:{targetId:legacy.id,type:'RECON',status:'COMPLETED',requiredUserAgent:'Historical-UA'}});
  let seen=0,release:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{release=resolve;}),original=p.$transaction.bind(p);
  const wrapped=(callback:unknown,options?:Parameters<typeof p.$transaction>[1])=>original(async tx=>{
    const target=new Proxy(tx.target,{get(delegate,key){if(key==='findFirst')return async(args:Prisma.TargetFindFirstArgs)=>{const row=await delegate.findFirst(args);if(args.where?.id===legacy.id&&args.where?.programId===null){seen++;if(seen===2)release();await barrier;}return row;};return Reflect.get(delegate,key);}});
    const proxy=new Proxy(tx,{get(client,key){return key==='target'?target:Reflect.get(client,key);}});
    return (callback as (tx:Prisma.TransactionClient)=>Promise<unknown>)(proxy);
  },options);
  const spy=vi.spyOn(p,'$transaction').mockImplementation(wrapped as typeof p.$transaction);
  try{
    const {mutateHost}=await import('@/server/programHosts');const results=await Promise.allSettled(programs.map(program=>mutateHost(userId,program.id,'ADD',{host:legacy.host,legacyTargetId:legacy.id})));
    const winners=results.filter(r=>r.status==='fulfilled'),losers=results.filter(r=>r.status==='rejected');expect(seen).toBe(2);expect(winners).toHaveLength(1);expect(losers).toHaveLength(1);expect(losers[0]).toMatchObject({reason:{status:409}});
    const saved=await p.target.findUniqueOrThrow({where:{id:legacy.id}});expect(saved.programId).toBe((winners[0] as PromiseFulfilledResult<{programId:string|null}>).value.programId);expect(saved.scopeId).toBe(scope.id);const loser=programs.find(program=>program.id!==saved.programId)!;expect((await p.bountyProgram.findUniqueOrThrow({where:{id:loser.id}})).scopeRules).toEqual([]);
    expect(await p.target.count({where:{userId}})).toBe(1);expect(await p.scanRun.findUniqueOrThrow({where:{id:scan.id}})).toMatchObject({targetId:legacy.id,requiredUserAgent:'Historical-UA'});
  }finally{release();spy.mockRestore();}
 });

 it.each([false,true])('reviews current Scope Asset authorization, including archived discovery parent=%s',async archived=>{
  const program=await p.bountyProgram.create({data:{ownerId:userId,companyName:'Asset review fixture',requiredUserAgent:'Fixture/1',scopeRules:['child.fixture.test']}}),scope=await p.scope.create({data:{userId,hostPattern:'child.fixture.test',status:'APPROVED'}}),asset=await p.scopeAsset.create({data:{programId:program.id,originalValue:archived?'*.fixture.test':'child.fixture.test',normalizedValue:archived?'*.fixture.test':'child.fixture.test',format:archived?'WILDCARD_DOMAIN':'SUBDOMAIN',type:'WEB_APPLICATION',active:!archived}});
  const target=await p.target.create({data:{userId,programId:program.id,scopeId:scope.id,host:'child.fixture.test',active:archived,...(archived?{discoveredFromAssetId:asset.id,discoverySource:'RECON'}:{scopeAssetId:asset.id})}}),finding=await p.finding.create({data:{targetId:target.id,title:'Explicit human review',reviewStatus:'EVIDENCE_REVIEW',evidence:'Synthetic observed baseline, probe and control'}});
  const {POST}=await import('@/app/api/findings/[id]/validate/route');const response=await POST(request('/api/findings/'+finding.id+'/validate','POST',{status:'CONFIRMED',notes:'Explicit local reproduction, impact and independent negative control reviewed.'}),{params:Promise.resolve({id:finding.id})});
  expect(response.status).toBe(archived?400:200);expect((await p.finding.findUniqueOrThrow({where:{id:finding.id}})).reviewStatus).toBe(archived?'EVIDENCE_REVIEW':'CONFIRMED');
 });

});
