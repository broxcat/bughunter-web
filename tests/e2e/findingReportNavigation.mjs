import assert from 'node:assert/strict';
export async function auditFindingReportCollections({prisma,owner,origin,context,page}){
 const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Finding collection fixture',requiredUserAgent:'Fixture/1'}});
 const scope=await prisma.scope.create({data:{userId:owner.id,hostPattern:'reports.fixture.test',status:'APPROVED'}});
 const target=await prisma.target.create({data:{userId:owner.id,programId:program.id,scopeId:scope.id,host:'reports.fixture.test'}});
 const findings=Array.from({length:51},(_,n)=>({id:program.id+'_finding_'+String(n).padStart(3,'0'),targetId:target.id,title:'Finding '+n,reviewStatus:'CONFIRMED',lifecycle:null,createdAt:new Date('2026-01-01')}));
 const reports=Array.from({length:51},(_,n)=>({id:program.id+'_report_'+String(n).padStart(3,'0'),userId:owner.id,targetId:target.id,title:'Saved report '+n,markdown:'# Historical report '+n,createdAt:new Date('2026-01-01')}));
 await prisma.finding.createMany({data:findings});await prisma.report.createMany({data:reports});await prisma.reportItem.createMany({data:reports.map(r=>({reportId:r.id,findingId:findings[25].id}))});let checks=0;
 for(const theme of ['light','dark'])for(const width of [1280,390])for(const kind of ['program','host','compose','saved']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('theme',t),theme);
  const path=kind==='program'?`/targets/${program.id}/findings`:kind==='host'?`/targets/${target.id}/findings`:`/targets/${program.id}/report`;
  const key=kind==='saved'?'reportPage':kind==='compose'?'findingPage':'page',query=new URLSearchParams({pageSize:'25'});
  const label=kind==='compose'?'Report finding pages':kind==='saved'?'Saved report pages':'Collection pages';
  const nav=page.getByRole('navigation',{name:label,exact:true});
  await page.goto(origin+path+'?'+query);if(kind==='compose')await page.getByLabel('Saved report',{exact:true}).waitFor();if(kind==='compose')await page.locator('summary').filter({hasText:/^Generate report$/}).evaluate(e=>{e.parentElement.open=true;});await nav.getByRole('status').filter({hasText:'Page 1 of 3'}).waitFor();
  if(kind==='compose')await page.getByRole('checkbox',{name:/^Finding 50 /}).check();
  for(const n of [2,3]){await nav.getByRole('link',{name:'Next page',exact:true}).click();await nav.getByRole('status').filter({hasText:`Page ${n} of 3`}).waitFor();}
  if(kind==='compose'){
   await page.getByRole('checkbox',{name:/^Finding 0 /}).check();
   assert(await page.getByText('Confirmed findings · 2 selected',{exact:true}).isVisible());
   let submitted;
   const endpoint=origin+'/api/reports',intercept=async route=>{if(route.request().method()!=='POST')return route.continue();submitted=route.request().postDataJSON();return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic report rejection"}'});};
   await context.route(endpoint,intercept);
   try{await page.getByLabel('Report title',{exact:true}).fill('Two-page selection');await page.getByRole('button',{name:'Generate report',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic report rejection'}).waitFor();assert.deepEqual(new Set(submitted.findingIds),new Set([findings[50].id,findings[0].id]));}
   finally{await context.unroute(endpoint,intercept);}
  }
  await page.reload();if(kind==='compose')await page.getByLabel('Saved report',{exact:true}).waitFor();if(kind==='compose')await page.locator('summary').filter({hasText:/^Generate report$/}).evaluate(e=>{e.parentElement.open=true;});await nav.getByRole('status').filter({hasText:'Page 3 of 3'}).waitFor();
  await nav.getByRole('link',{name:'Previous page',exact:true}).click();await nav.getByRole('status').filter({hasText:'Page 2 of 3'}).waitFor();
  await page.goBack();await nav.getByRole('status').filter({hasText:'Page 3 of 3'}).waitFor();await page.goForward();await nav.getByRole('status').filter({hasText:'Page 2 of 3'}).waitFor();
  for(const v of ['invalid','999']){query.set(key,v);await page.goto(origin+path+'?'+query);if(kind==='compose')await page.getByLabel('Saved report',{exact:true}).waitFor();if(kind==='compose')await page.locator('summary').filter({hasText:/^Generate report$/}).evaluate(e=>{e.parentElement.open=true;});await nav.getByRole('status').filter({hasText:v==='invalid'?'Page 1 of 3':'Page 3 of 3'}).waitFor();}
  if(kind==='saved')await prisma.report.delete({where:{id:reports[0].id}});else await prisma.finding.delete({where:{id:findings[0].id}});
  await page.reload();if(kind==='compose')await page.getByLabel('Saved report',{exact:true}).waitFor();if(kind==='compose')await page.locator('summary').filter({hasText:/^Generate report$/}).evaluate(e=>{e.parentElement.open=true;});await nav.getByRole('status').filter({hasText:'Page 2 of 2'}).waitFor();
  if(kind==='saved'){await prisma.report.create({data:reports[0]});await prisma.reportItem.create({data:{reportId:reports[0].id,findingId:findings[25].id}});}else await prisma.finding.create({data:findings[0]});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;
 }
 console.log(`FINDING_REPORT_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
