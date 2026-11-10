import type {ReactElement} from 'react';
import {beforeAll,beforeEach,afterAll,it,expect,describe,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='pagination_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let p:typeof import('@/lib/prisma').prisma,get:typeof import('@/app/api/programs/route').GET,ownerId:string;
(db?describe:describe.skip)('Program collection navigation',()=>{
 beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));({GET:get}=await import('@/app/api/programs/route'));},30000);
 beforeEach(async()=>{ownerId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;mocks.auth.mockResolvedValue({user:{id:ownerId}});});
 afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
 const request=(query='')=>new Request('http://app.example.test/api/programs?'+query);
 const seed=(count:number)=>p.bountyProgram.createMany({data:Array.from({length:count},(_,i)=>({id:ownerId+'_'+String(i).padStart(3,'0'),ownerId,companyName:'Duplicate name',requiredUserAgent:'Fixture/1'}))});
 it('preserves tied-name ordering when unrelated metadata changes',async()=>{await seed(51);const before=await(await get(request())).json();await p.bountyProgram.update({where:{id:before[0].id},data:{programUrl:'https://fixture.test'}});const after=await(await get(request())).json();expect(after.map((r:{id:string})=>r.id)).toEqual(before.map((r:{id:string})=>r.id));});
 it('bounds page two instead of returning the full collection',async()=>{await seed(51);const body=await(await get(request('page=2&pageSize=25'))).json();expect(body.items).toHaveLength(25);expect(body).toMatchObject({page:2,pages:3,total:51,pageSize:25});});
 it.each([0,1,25,51])('bounds empty/single/exact/multiple-page collections: %i',async count=>{
  await seed(count);
  for(const page of [1,2,3,999]){
   const response=await get(request(`page=${page}&pageSize=25`));expect(response.status).toBe(200);const body=await response.json();
   const actual=Math.min(page,Math.max(1,Math.ceil(count/25)));expect(body.page).toBe(actual);
   expect(body.total).toBe(count);expect(body.items).toHaveLength(Math.min(25,Math.max(0,count-(actual-1)*25)));
   expect(body.items.map((r:{id:string})=>r.id)).toEqual(Array.from({length:body.items.length},(_,i)=>ownerId+'_'+String((actual-1)*25+i).padStart(3,'0')));
  }
 });
 it.each(['page=0','page=-1','page=no','page=1000001','pageSize=0','pageSize=101','pageSize=1.5'])('rejects invalid pagination: %s',async query=>{expect((await get(request(query))).status).toBe(400);});
 it('handles size boundaries, filtering, owner isolation and last-row deletion',async()=>{
  await seed(51);expect((await(await get(request('page=51&pageSize=1'))).json()).items).toHaveLength(1);
  expect((await(await get(request('page=1&pageSize=100'))).json()).items).toHaveLength(51);
  await p.bountyProgram.update({where:{id:ownerId+'_050'},data:{companyName:'Unique filter'}});
  expect(await(await get(request('page=999&q=UNIQUE'))).json()).toMatchObject({total:1,page:1});
  expect(await(await get(request('page=999&q=absent'))).json()).toMatchObject({total:0,page:1,items:[]});
  await p.bountyProgram.delete({where:{id:ownerId+'_050'}});
  expect(await(await get(request('page=3'))).json()).toMatchObject({page:2,pages:2,total:50});
  mocks.auth.mockResolvedValue({user:{id:'not-owner'}});expect(await(await get(request('page=1'))).json()).toMatchObject({total:0,items:[]});
  mocks.auth.mockResolvedValue(null);expect((await get(request('page=1'))).status).toBe(401);
 });
 it('reaches Scope assets beyond the former 1000-row cap',async()=>{
  await seed(1);await p.scopeAsset.createMany({data:Array.from({length:1001},(_,n)=>({id:ownerId+'_asset_'+String(n).padStart(4,'0'),programId:ownerId+'_000',originalValue:`h${n}.fixture.test`,normalizedValue:`h${n}.fixture.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION',active:false}))});
  const {GET}=await import('@/app/api/scope-assets/route');
  const response=await GET(new Request('http://app.example.test/api/scope-assets?page=41&target='+ownerId+'_000'));
  expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({page:41,pages:41,total:1001});expect(body.items).toHaveLength(1);
 });
 it('reaches Research hosts and immutable history beyond former caps',async()=>{
  await seed(1);const programId=ownerId+'_000';await p.bountyProgram.update({where:{id:programId},data:{scopeRules:['*.fixture.test']}});const scope=await p.scope.create({data:{userId:ownerId,hostPattern:'*.fixture.test',status:'APPROVED'}});
  await p.target.createMany({data:Array.from({length:501},(_,n)=>({id:ownerId+'_host_'+String(n).padStart(4,'0'),userId:ownerId,programId,scopeId:scope.id,host:`h${String(n).padStart(4,'0')}.fixture.test`,contextOnly:false}))});
  await p.researchSession.createMany({data:Array.from({length:101},(_,n)=>({id:ownerId+'_session_'+String(n).padStart(3,'0'),userId:ownerId,targetId:ownerId+'_host_0000',workspaceId:randomUUID(),status:'ARCHIVED',targetHost:'h0000.fixture.test',programName:'Fixture',scopeMarkdown:'# Historical snapshot',createdAt:new Date('2026-01-01')}))});
  const Page=(await import('@/app/(dashboard)/research/page')).default;
  const links:string[]=[],texts:string[]=[];const visit=(node:unknown)=>{
   if(typeof node==='string'){texts.push(node);return;}
   if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}
   const element=node as ReactElement<{href?:string;children?:unknown}>;
   if(element.props?.href)links.push(element.props.href);visit(element.props?.children);
  };
  visit(await Page({searchParams:Promise.resolve({page:'21',historyPage:'5',program:programId})}));
  expect(texts).toContain('h0500.fixture.test');expect(links).toContain('/research/history/'+ownerId+'_session_000');
  const {GET}=await import('@/app/api/research-sessions/route');const body=await(await GET(new Request('http://app.example.test/api/research-sessions?page=5'))).json();expect(body).toMatchObject({total:101,page:5});expect(body.items).toHaveLength(1);
 });
 it('reaches Program Findings and Reports beyond legacy caps',async()=>{
  await seed(1);const programId=ownerId+'_000',scope=await p.scope.create({data:{userId:ownerId,hostPattern:'fixture.test'}});
  const target=await p.target.create({data:{userId:ownerId,programId,scopeId:scope.id,host:'fixture.test'}});
  await p.finding.createMany({data:Array.from({length:1001},(_,n)=>({id:ownerId+'_finding_'+String(n).padStart(4,'0'),targetId:target.id,title:'Finding fixture',createdAt:new Date('2026-01-01')}))});
  await p.report.createMany({data:Array.from({length:101},(_,n)=>({id:ownerId+'_report_'+String(n).padStart(3,'0'),userId:ownerId,targetId:target.id,title:'Report fixture',createdAt:new Date('2026-01-01')}))});
  await p.reportItem.createMany({data:Array.from({length:101},(_,n)=>({reportId:ownerId+'_report_'+String(n).padStart(3,'0'),findingId:ownerId+'_finding_0000'}))});
  const {NextRequest}=await import('next/server');
  for(const [path,page,total] of [['findings',41,1001],['reports',5,101]] as const){
   const {GET}=path==='findings'?await import('@/app/api/findings/route'):await import('@/app/api/reports/route');
   const body=await(await GET(new NextRequest(`http://app.example.test/api/${path}?programId=${programId}&page=${page}`))).json();
   expect.soft(body).toMatchObject({page,total});expect.soft(body.items).toHaveLength(1);
  }
 });
 it('reaches legacy Hunt history beyond the former 100-run cap',async()=>{
  const scope=await p.scope.create({data:{userId:ownerId,hostPattern:'fixture.test'}}),target=await p.target.create({data:{userId:ownerId,scopeId:scope.id,host:'fixture.test'}});
  await p.scanRun.createMany({data:Array.from({length:101},(_,n)=>({id:ownerId+'_hunt_'+String(n).padStart(3,'0'),targetId:target.id,type:'HUNT',status:'COMPLETED',createdAt:new Date('2026-01-01')}))});
  const Page=(await import('@/app/(dashboard)/hunt/page')).default;
  const links:string[]=[];const visit=(node:unknown)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}const props=(node as {props?:{href?:string;children?:unknown}}).props;if(props?.href)links.push(props.href);visit(props?.children);};
  visit(await Page({searchParams:Promise.resolve({page:'5'})}));expect(links.filter(h=>h.startsWith('/hunt/'))).toHaveLength(1);expect(links).toContain('/hunt/'+ownerId+'_hunt_000');
 });
 it('reaches Vault evidence after the first 100 records',async()=>{
  const program=await p.bountyProgram.create({data:{ownerId,companyName:'Evidence fixture',requiredUserAgent:'Fixture/1'}}),scope=await p.scope.create({data:{userId:ownerId,hostPattern:'fixture.test'}}),target=await p.target.create({data:{userId:ownerId,programId:program.id,scopeId:scope.id,host:'fixture.test'}});
  await p.evidenceRecord.createMany({data:Array.from({length:101},(_,n)=>({id:ownerId+'_ev_'+String(n).padStart(3,'0'),targetId:target.id,kind:'RESEARCH_EVIDENCE',sourceKey:String(n),description:'Synthetic evidence',provenance:{},redactionStatus:'METADATA_ONLY',metadata:{},createdAt:new Date('2026-01-01')}))});
  const {listEvidence}=await import('@/server/evidenceVault');const first=await listEvidence(ownerId,target.id);expect(first.items).toHaveLength(100);expect(first.nextCursor).toEqual(expect.any(String));
  const last=await listEvidence(ownerId,target.id,{},first.nextCursor!);expect(last.items).toHaveLength(1);expect(last.nextCursor).toBeNull();expect(first.items.some(r=>r.id===last.items[0].id)).toBe(false);
  await expect(listEvidence('foreign-owner',target.id)).rejects.toMatchObject({status:404});
  for(const cursor of ['invalid','?'.repeat(513),Buffer.from(JSON.stringify({id:'../bad',createdAt:'2026-01-01T00:00:00.000Z'})).toString('base64url')])await expect(listEvidence(ownerId,target.id,{},cursor)).rejects.toMatchObject({status:400});
  await p.evidenceRecord.delete({where:{id:first.items[99].id}});expect((await listEvidence(ownerId,target.id,{},first.nextCursor!)).items).toHaveLength(1);
  await p.evidenceRecord.delete({where:{id:last.items[0].id}});expect(await listEvidence(ownerId,target.id,{},first.nextCursor!)).toMatchObject({reset:true,nextCursor:null});
 });
 it('clamps Hypothesis pages and revision history beyond the end',async()=>{
  const scope=await p.scope.create({data:{userId:ownerId,hostPattern:'fixture.test'}}),target=await p.target.create({data:{userId:ownerId,scopeId:scope.id,host:'fixture.test'}}),session=await p.researchSession.create({data:{userId:ownerId,targetId:target.id,workspaceId:randomUUID(),targetHost:target.host,programName:'Fixture',scopeMarkdown:'# Immutable'}});
  await p.researchHypothesis.createMany({data:Array.from({length:51},(_,n)=>({id:ownerId+'_hyp_'+String(n).padStart(3,'0'),sessionId:session.id,externalId:'H-'+String(n+1).padStart(3,'0'),title:'Hypothesis fixture',status:'OPEN',hypothesis:'Unknown',evidenceFor:[],evidenceAgainst:[],nextTest:'Manual',expectedSignal:'Unknown',falsificationCondition:'Unknown',contentSha256:'a'.repeat(64)}))});
  const h=await import('@/server/research/hypotheses');expect.soft(await h.listHypotheses(session.id,ownerId,undefined,99)).toMatchObject({page:3,total:51});
  const hypothesisId=ownerId+'_hyp_000';await p.researchHypothesisRevision.createMany({data:Array.from({length:26},(_,n)=>({hypothesisId,revision:n+1,snapshot:{status:'OPEN'}}))});
  const detail=await h.hypothesisDetail(session.id,hypothesisId,ownerId,99);expect(detail.revisionPage).toBe(2);expect(detail.hypothesis.revisions).toHaveLength(1);
 });
 it('pages Target Scope management without fetching archived rows',async()=>{
  await seed(1);const programId=ownerId+'_000';await p.scopeAsset.createMany({data:Array.from({length:101},(_,n)=>({id:ownerId+'_managed_'+String(n).padStart(3,'0'),programId,originalValue:`h${n}.fixture.test`,normalizedValue:`h${n}.fixture.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION',active:n<51}))});
  const {GET}=await import('@/app/api/programs/[id]/assets/route'),ctx={params:Promise.resolve({id:programId})};
  const body=await(await GET(new Request('http://app.example.test/api/programs/'+programId+'/assets?page=2&active=1'),ctx)).json();expect(body).toMatchObject({total:51,page:2});expect(body.items).toHaveLength(25);expect(body.items.every((a:{active:boolean})=>a.active)).toBe(true);
 });
 it('bounds the previous-host inventory before transferring it to Scope',async()=>{
  await seed(1);const scope=await p.scope.create({data:{userId:ownerId,hostPattern:'*.fixture.test',status:'APPROVED'}});
  await p.target.createMany({data:Array.from({length:52},(_,n)=>({id:ownerId+'_legacy_'+String(n).padStart(3,'0'),userId:ownerId,scopeId:scope.id,host:`h${String(n).padStart(3,'0')}.fixture.test`,programId:n===51?ownerId+'_000':null}))});
  const {GET}=await import('@/app/api/targets/route');const body=await(await GET(new Request('http://app.example.test/api/targets?legacy=1&page=2'))).json();expect(body).toMatchObject({page:2,total:51});expect(body.items).toHaveLength(25);expect(body.items.every((row:{programId:string|null})=>row.programId===null)).toBe(true);expect(body.items[0]).not.toHaveProperty('scope');
 });
 it('keeps count, clamping and row count consistent under concurrent insertion/removal',async()=>{
  await seed(25);
  await Promise.all([
   (async()=>{for(let n=0;n<10;n++){const x=await p.bountyProgram.create({data:{ownerId,companyName:'Transient',requiredUserAgent:'Fixture/1'}});await p.bountyProgram.delete({where:{id:x.id}});}})(),
   (async()=>{for(let n=0;n<10;n++){const body=await(await get(request('page=999'))).json();expect(body.items).toHaveLength(Math.min(body.pageSize,body.total-(body.page-1)*body.pageSize));expect(new Set(body.items.map((x:{id:string})=>x.id)).size).toBe(body.items.length);}})()
  ]);
 });
});
