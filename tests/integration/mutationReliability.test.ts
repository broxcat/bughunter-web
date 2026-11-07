import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='mutation_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,userId:string;
const request=(path:string,method:string,body?:unknown,origin?:string)=>new NextRequest('http://app.example.test'+path,{method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
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

});
