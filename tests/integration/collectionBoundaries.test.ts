import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='boundaries_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,userId:string,programId:string,targetId:string,scopeId:string;
const kinds=['legacy','scope','sessions','findings','reports','hunt'] as const;
type Kind=typeof kinds[number] | 'hosts' | 'history';
function findProps(node:unknown,label:string):Record<string,unknown>|undefined{
 if(!node||typeof node!=='object')return;
 if(Array.isArray(node)){for(const item of node){const found=findProps(item,label);if(found)return found;}return;}
 const props=(node as {props?:Record<string,unknown>}).props;
 if(props?.label===label)return props;
 return findProps(props?.children,label);
}
(db?describe:describe.skip)('Bounded collection boundaries and privacy',()=>{
 beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));},30000);
 beforeEach(async()=>{
  userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;mocks.auth.mockResolvedValue({user:{id:userId}});
  programId=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Fixture',requiredUserAgent:'Fixture/1'}})).id;
  scopeId=(await p.scope.create({data:{userId,hostPattern:'*.fixture.test',status:'APPROVED'}})).id;
  targetId=(await p.target.create({data:{userId,programId,scopeId,host:'scaffold.fixture.test',active:false}})).id;
 });
 afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
 async function seed(kind:Kind,count:number){
  const id=(n:number)=>programId+'_'+String(n).padStart(3,'0'),createdAt=new Date('2026-01-01');
  if(kind==='legacy')await p.target.createMany({data:Array.from({length:count},(_,n)=>({id:id(n),userId,scopeId,host:`h${String(n).padStart(3,'0')}.fixture.test`}))});
  if(kind==='scope')await p.scopeAsset.createMany({data:Array.from({length:count},(_,n)=>({id:id(n),programId,originalValue:`h${n}.fixture.test`,normalizedValue:`h${n}.fixture.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION',active:false}))});
  if(kind==='hosts'){await p.bountyProgram.createMany({data:Array.from({length:count},(_,n)=>({id:id(n)+'_program',ownerId:userId,companyName:'Same name',requiredUserAgent:'Fixture/1'}))});await p.target.createMany({data:Array.from({length:count},(_,n)=>({id:id(n),userId,programId:id(n)+'_program',scopeId,host:'same.fixture.test'}))});}
  if(kind==='history'||kind==='sessions')await p.researchSession.createMany({data:Array.from({length:count},(_,n)=>({id:id(n),userId,targetId,workspaceId:randomUUID(),status:'ARCHIVED',targetHost:'same.fixture.test',programName:'Fixture',scopeMarkdown:'# Snapshot',createdAt}))});
  if(kind==='findings')await p.finding.createMany({data:Array.from({length:count},(_,n)=>({id:id(n),targetId,title:'Same finding',createdAt}))});
  if(kind==='hunt')await p.scanRun.createMany({data:Array.from({length:count},(_,n)=>({id:id(n),targetId,type:'HUNT',status:'COMPLETED',createdAt}))});
  if(kind==='reports')await p.report.createMany({data:Array.from({length:count},(_,n)=>({id:id(n),userId,targetId,title:'Same report',createdAt}))});
 }
 async function read(kind:Kind,query:string){
  if(kind==='hunt'){const Page=(await import('@/app/(dashboard)/hunt/page')).default;return findProps(await Page({searchParams:Promise.resolve(Object.fromEntries(new URLSearchParams(query)))}),'Hunt history pages')!;}
  if(kind==='hosts'||kind==='history'){
   const Page=(await import('@/app/(dashboard)/research/page')).default;
   const params=Object.fromEntries(new URLSearchParams(query));if(kind==='history'){params.historyPage=params.page;delete params.page;}
   const node=await Page({searchParams:Promise.resolve({...params,...(kind==='history'?{program:programId}:{})})});
   return findProps(node,kind==='hosts'?'Research hosts pages':'Research history pages')!;
  }
  const path={legacy:'targets',scope:'scope-assets',sessions:'research-sessions',findings:'findings',reports:'reports'}[kind];
  const identity=kind==='legacy'?'legacy=1':kind==='scope'?`target=${programId}`:kind==='sessions'?'':`targetId=${targetId}`;
  const req=new NextRequest(`http://app.example.test/api/${path}?${identity}&${query}`);
  const handler=kind==='legacy'?await import('@/app/api/targets/route'):kind==='scope'?await import('@/app/api/scope-assets/route'):kind==='sessions'?await import('@/app/api/research-sessions/route'):kind==='findings'?await import('@/app/api/findings/route'):await import('@/app/api/reports/route');
  const r=await handler.GET(req);expect(r.status).toBe(200);return r.json();
 }
 for(const kind of kinds)it.each([0,1,25,51])(`${kind}: empty/single/exact/multiple pages (%i)`,async count=>{
  await seed(kind,count);
  for(const page of [1,2,3,999]){
   const data=await read(kind,`page=${page}`),actual=Math.min(page,Math.max(1,Math.ceil(count/25)));
   expect(data).toMatchObject({page:actual,pages:Math.max(1,Math.ceil(count/25)),total:count});
   if(data.items){expect(data.items).toHaveLength(Math.min(25,Math.max(0,count-(actual-1)*25)));expect(new Set(data.items.map((r:{id:string})=>r.id)).size).toBe(data.items.length);}
  }
  for(const size of [1,100])expect(await read(kind,`page=999&pageSize=${size}`)).toMatchObject({page:Math.max(1,Math.ceil(count/size)),total:count,pageSize:size});
  expect(await read(kind,'page=999&q=absent-fixture')).toMatchObject({page:1,total:0});
  const first=await read(kind,'page=1'),again=await read(kind,'page=1');
  if(first.items)expect(again.items.map((r:{id:string})=>r.id)).toEqual(first.items.map((r:{id:string})=>r.id));
 });
 for(const kind of ['legacy','scope','sessions','findings','reports'] as const)it(`${kind}: invalid page, anonymous and private identity`,async()=>{
  const path={legacy:'targets',scope:'scope-assets',sessions:'research-sessions',findings:'findings',reports:'reports'}[kind];
  const identity=kind==='legacy'?'legacy=1':kind==='scope'?`target=${programId}`:kind==='sessions'?'':`targetId=${targetId}`;
  const handler=kind==='legacy'?await import('@/app/api/targets/route'):kind==='scope'?await import('@/app/api/scope-assets/route'):kind==='sessions'?await import('@/app/api/research-sessions/route'):kind==='findings'?await import('@/app/api/findings/route'):await import('@/app/api/reports/route');
  const req=(page:string)=>new NextRequest(`http://app.example.test/api/${path}?${identity}&page=${page}`);
  for(const page of ['0','-1','no','1000001'])expect((await handler.GET(req(page))).status).toBe(400);
  mocks.auth.mockResolvedValue({user:{id:'foreign-owner'}});
  const r=await handler.GET(req('1'));expect(r.status).toBe(kind==='findings'||kind==='reports'?404:200);if(r.status===200)expect((await r.json()).items).toEqual([]);
  mocks.auth.mockResolvedValue(null);expect((await handler.GET(req('1'))).status).toBe(401);
 });
});
