import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function auditScopeResearchCollections({prisma,owner,origin,page}){
 const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Bounded inventory fixture',requiredUserAgent:'Fixture/1',scopeRules:['*.inventory.test']}});
 const scope=await prisma.scope.create({data:{userId:owner.id,hostPattern:'*.inventory.test',status:'APPROVED'}});
 const assets=Array.from({length:51},(_,n)=>({id:program.id+'_asset_'+String(n).padStart(3,'0'),programId:program.id,originalValue:`h${String(n).padStart(3,'0')}.inventory.test`,normalizedValue:`h${String(n).padStart(3,'0')}.inventory.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION',active:false}));
 const targets=assets.map((a,n)=>({id:program.id+'_host_'+String(n).padStart(3,'0'),userId:owner.id,programId:program.id,scopeId:scope.id,discoverySource:'FIXTURE',host:a.normalizedValue}));
 const history=targets.map((t,n)=>({id:program.id+'_session_'+String(n).padStart(3,'0'),userId:owner.id,targetId:t.id,workspaceId:randomUUID(),status:'ARCHIVED',targetHost:t.host,programName:program.companyName,scopeMarkdown:'# Immutable fixture',createdAt:new Date('2026-01-01')}));
 assets[0]={...assets[0],originalValue:'*.inventory.test',normalizedValue:'*.inventory.test',format:'WILDCARD_DOMAIN'};
 await prisma.scopeAsset.createMany({data:assets});await prisma.target.createMany({data:targets});await prisma.researchSession.createMany({data:history});const management=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Scope management fixture',requiredUserAgent:'Fixture/1'}});
 const managed=assets.map((a,n)=>({...a,id:management.id+'_'+n,programId:management.id,active:true}));await prisma.scopeAsset.createMany({data:managed});
 const hunts=Array.from({length:51},(_,n)=>({id:program.id+'_hunt_'+String(n).padStart(3,'0'),targetId:targets[0].id,type:'HUNT',status:'COMPLETED',createdAt:new Date('2026-01-01')}));await prisma.scanRun.createMany({data:hunts});let checks=0;
 for(const theme of ['light','dark'])for(const width of [1280,390])for(const kind of ['scope','hosts','history','management','hunt']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('theme',t),theme);
  const path=kind==='scope'?'/scopes':kind==='management'?'/scopes':kind==='hunt'?'/hunt':'/research',key=kind==='history'?'historyPage':kind==='management'?'assetPage':'page';
  const query=new URLSearchParams({[kind==='scope'||kind==='management'?'target':'program']:kind==='management'?management.id:program.id,pageSize:'25',...(kind==='scope'?{inventory:'1'}:{})});
  const nav=page.getByRole('navigation',{name:kind==='scope'?'Collection pages':kind==='hosts'?'Research hosts pages':kind==='management'?'Scope management pages':kind==='hunt'?'Hunt history pages':'Research history pages',exact:true});
  if(kind==='history')query.set(key,'1');
  if(kind==='scope'){await page.goto(origin+'/scopes?inventory=1&target=missing-fixture');await nav.getByRole('status').filter({hasText:'Page 1 of 1 · 0'}).waitFor();assert.equal(await page.getByLabel('Filter Target',{exact:true}).inputValue(),'missing-fixture');assert.equal(await page.getByLabel('Filter Target',{exact:true}).locator('option:checked').innerText(),'Unavailable Target');}
  await page.goto(origin+path+'?'+query);await nav.getByRole('status').filter({hasText:'Page 1 of 3'}).waitFor();
  for(const n of [2,3]){await nav.getByRole('link',{name:'Next page',exact:true}).click();await nav.getByRole('status').filter({hasText:`Page ${n} of 3`}).waitFor();}
  await page.reload();await nav.getByRole('status').filter({hasText:'Page 3 of 3'}).waitFor();
  await nav.getByRole('link',{name:'Previous page',exact:true}).click();await nav.getByRole('status').filter({hasText:'Page 2 of 3'}).waitFor();
  await page.goBack();await nav.getByRole('status').filter({hasText:'Page 3 of 3'}).waitFor();await page.goForward();await nav.getByRole('status').filter({hasText:'Page 2 of 3'}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get(kind==='scope'||kind==='management'?'target':'program'),kind==='management'?management.id:program.id);
  for(const v of ['invalid','999']){query.set(key,v);await page.goto(origin+path+'?'+query);await nav.getByRole('status').filter({hasText:v==='invalid'?'Page 1 of 3':'Page 3 of 3'}).waitFor();}
  // Disposable DB-only removal simulates another writer. Historical sessions
  // have no product delete operation; this is not a newly exposed capability.
  if(kind==='management')await prisma.scopeAsset.update({where:{id:managed[50].id},data:{active:false}});
  if(kind==='hunt')await prisma.scanRun.delete({where:{id:hunts[0].id}});
  if(kind==='scope')await prisma.scopeAsset.delete({where:{id:assets[50].id}});
  if(kind==='history')await prisma.researchSession.delete({where:{id:history[0].id}});
  if(kind==='hosts')await prisma.target.update({where:{id:targets[50].id},data:{active:false}});
  await page.reload();await nav.getByRole('status').filter({hasText:'Page 2 of 2'}).waitFor();
  if(kind==='management')await prisma.scopeAsset.update({where:{id:managed[50].id},data:{active:true}});
  if(kind==='hunt')await prisma.scanRun.create({data:hunts[0]});
  if(kind==='scope')await prisma.scopeAsset.create({data:assets[50]});
  if(kind==='history')await prisma.researchSession.create({data:history[0]});
  if(kind==='hosts')await prisma.target.update({where:{id:targets[50].id},data:{active:true}});
  if(kind!=='management'){const field=page.getByLabel(kind==='scope'?'Search assets':'Search hosts',{exact:true});await field.fill('no matching inventory fixture');await page.getByRole('button',{name:'Search',exact:true}).click();
  if(kind==='history')await page.getByText('Historical Research Sessions',{exact:true}).click();
  await nav.getByRole('status').filter({hasText:'Page 1 of 1 · 0'}).waitFor();assert.equal(new URL(page.url()).searchParams.has(key),false);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;
 }
 console.log(`SCOPE_RESEARCH_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
