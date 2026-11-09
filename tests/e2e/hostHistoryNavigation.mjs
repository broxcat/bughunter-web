import assert from 'node:assert/strict';
export async function auditHostHistoryNavigation({prisma,owner,origin,page}){
 const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Host history fixture',requiredUserAgent:'Fixture/1'}}),scope=await prisma.scope.create({data:{userId:owner.id,hostPattern:'history.fixture.test',status:'APPROVED'}}),target=await prisma.target.create({data:{userId:owner.id,programId:program.id,scopeId:scope.id,host:'history.fixture.test'}});
 const rows=Array.from({length:51},(_,n)=>({id:program.id+'_'+String(n).padStart(3,'0'),targetId:target.id,type:'RECON',status:'COMPLETED',createdAt:new Date('2026-01-01')}));await prisma.scanRun.createMany({data:rows});let checks=0;
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('theme',t),theme);
  const path=origin+'/hosts/'+target.id,nav=page.getByRole('navigation',{name:'Host history pages',exact:true}),status=text=>nav.getByRole('status').filter({hasText:text});
  await page.goto(path+'?scanPage=1');await status('Page 1 of 3').waitFor();
  await page.getByRole('link',{name:'← Scope',exact:true}).click();await page.waitForURL(origin+'/scopes?target='+program.id);await page.getByRole('heading',{name:/^Scopes?$/,exact:false}).waitFor();
  await page.goBack();await status('Page 1 of 3').waitFor();
  for(const n of [2,3]){await nav.getByRole('link',{name:'Next page',exact:true}).click();await status(`Page ${n} of 3`).waitFor();}
  await page.reload();await status('Page 3 of 3').waitFor();await nav.getByRole('link',{name:'Previous page',exact:true}).click();await status('Page 2 of 3').waitFor();
  await page.goBack();await status('Page 3 of 3').waitFor();await page.goForward();await status('Page 2 of 3').waitFor();
  for(const value of ['invalid','999']){await page.goto(path+'?scanPage='+value);await status(value==='invalid'?'Page 1 of 3':'Page 3 of 3').waitFor();}
  await prisma.scanRun.delete({where:{id:rows[0].id}});await page.reload();await status('Page 2 of 2 · 50').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await prisma.scanRun.create({data:rows[0]});checks++;
 }
 console.log(`HOST_HISTORY_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
