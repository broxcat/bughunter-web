import assert from 'node:assert/strict';
export async function auditLegacyHostNavigation({prisma,owner,origin,page}){
 const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Previous-host navigation fixture',requiredUserAgent:'Fixture/1'}});
 const scope=await prisma.scope.create({data:{userId:owner.id,hostPattern:'*.previous.test',status:'APPROVED'}});
 const rows=Array.from({length:51},(_,n)=>({id:program.id+'_'+String(n).padStart(3,'0'),userId:owner.id,scopeId:scope.id,host:`h${String(n).padStart(3,'0')}.previous.test`}));
 await prisma.target.createMany({data:rows});let checks=0;
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('theme',t),theme);
  const nav=page.getByRole('navigation',{name:'Previous host pages',exact:true}),status=n=>nav.getByRole('status').filter({hasText:n});
  await page.goto(origin+'/scopes?legacyPage=1');await status('Page 1 of 3 · 51').waitFor();
  for(const n of [2,3]){await nav.getByRole('link',{name:'Next page',exact:true}).click();await status(`Page ${n} of 3`).waitFor();}
  await page.reload();await status('Page 3 of 3').waitFor();
  await nav.getByRole('link',{name:'Previous page',exact:true}).click();await status('Page 2 of 3').waitFor();
  await page.goBack();await status('Page 3 of 3').waitFor();await page.goForward();await status('Page 2 of 3').waitFor();
  for(const value of ['invalid','999']){await page.goto(origin+'/scopes?legacyPage='+value);await status(value==='invalid'?'Page 1 of 3':'Page 3 of 3').waitFor();}
  // The real adoption mutation removes the final legacy row from this collection.
  const card=page.getByRole('link',{name:rows[50].host+' — History',exact:true}).locator('..');
  await card.getByLabel('Target for '+rows[50].host,{exact:true}).selectOption(program.id);await card.getByRole('button',{name:'Add to Scope',exact:true}).click();
  await page.waitForURL(origin+'/scopes?target='+program.id);await page.goto(origin+'/scopes');await page.getByText('Previous hosts and scan history',{exact:true}).click();await status('Page 1 of 2 · 50').waitFor();
  const adopted=await prisma.target.findUniqueOrThrow({where:{id:rows[50].id}});assert.equal(adopted.programId,program.id);assert.equal(adopted.scopeId,scope.id);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Restore only this disposable fixture between viewport/theme checks.
  await prisma.target.update({where:{id:rows[50].id},data:{programId:null,scopeAssetId:null}});
  await prisma.scopeAsset.deleteMany({where:{programId:program.id}});checks++;
 }
 console.log(`LEGACY_HOST_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
