import assert from 'node:assert/strict';
export async function auditMilestone7Launcher({prisma,owner,origin,context,page}) {
 const errors=[];const onError=error=>errors.push(error.message);page.on('pageerror',onError);
 let checks=0;const pass=name=>console.log(`M7 PASS ${++checks}: ${name}`);
 const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'M7 launcher fixture',requiredUserAgent:'M7-Local/1'}});
 const scope=await prisma.scope.create({data:{userId:owner.id,hostPattern:'launcher.fixture.test',status:'APPROVED'}});
 const target=await prisma.target.create({data:{userId:owner.id,programId:program.id,scopeId:scope.id,host:'launcher.fixture.test',scheme:'https'}});
 let unavailable=false;
 let engines=[{provider:'codex',installation:'available',authentication:'authenticated',version:'0.165.0',code:null,profiles:['standard','yolo'],runningProfile:null},{provider:'claude',installation:'available',authentication:'required',version:'2.1.312',code:'AUTH_REQUIRED',profiles:['standard','plan'],runningProfile:null}];
 const pattern=`**/api/research-targets/${target.id}/launcher`;
 await context.route(pattern,route=>unavailable?route.fulfill({status:503,json:{error:'Unavailable'}}):route.fulfill({json:{engines}}));
 const ticketPattern=`**/api/research-targets/${target.id}/terminal`;
 let selections=[];await context.route(ticketPattern,route=>{selections.push(route.request().postDataJSON());return route.fulfill({status:503,json:{error:'Disposable native console unavailable'}});});
 try {
  const url=`${origin}/research?program=${program.id}`;
  for(const width of [1280,390])for(const theme of ['light','dark']) {
   await page.setViewportSize({width,height:900});await page.goto(url);await page.evaluate(value=>{localStorage.setItem('bughunter.theme',value);document.documentElement.dataset.theme=value;},theme);
   const launcher=page.locator(`[aria-label="Launcher for ${target.host}"]`);
   await launcher.locator('summary').filter({hasText:'Engine details'}).evaluate(e=>{e.parentElement.open=true;});await launcher.getByRole('button',{name:'Check readiness',exact:true}).click();await launcher.getByRole('status').filter({hasText:'Authenticated'}).waitFor();
   assert.equal(await launcher.getByLabel('Launch profile',{exact:true}).locator('option').count(),2,await launcher.evaluate(element=>element.outerHTML));
   await launcher.getByLabel('Launch profile',{exact:true}).selectOption('yolo');assert.match(await launcher.innerText(),/methodology confirmation gates/);
   const open=launcher.getByRole('link',{name:`Open console — ${target.host}`,exact:true});await open.focus();assert(await open.evaluate(element=>element===document.activeElement));
   await page.keyboard.press('Enter');await page.waitForURL(`${origin}/research/${target.id}?engine=codex&profile=yolo`);await page.getByRole('alert').filter({hasText:'Disposable native console unavailable'}).waitFor();
   assert.deepEqual(selections.at(-1),{provider:'codex',profile:'yolo'});assert.match(await page.locator('body').innerText(),/YOLO bypasses native Codex/);
   await page.getByRole('link',{name:'← Research',exact:true}).click();await page.waitForURL(origin+'/research');
   await page.goto(url);await launcher.locator('summary').filter({hasText:'Engine details'}).evaluate(e=>{e.parentElement.open=true;});await launcher.getByRole('button',{name:'Check readiness',exact:true}).click();await launcher.getByRole('status').filter({hasText:'Authenticated'}).waitFor();
   await launcher.getByLabel('Engine',{exact:true}).selectOption('claude');assert.match(await launcher.getByRole('status').innerText(),/Login required/);
   await launcher.getByLabel('Launch profile',{exact:true}).selectOption('plan');assert.equal(await launcher.getByLabel('Launch profile',{exact:true}).locator('option[value="yolo"]').count(),0);
   await launcher.getByRole('link',{name:`Open console — ${target.host}`,exact:true}).click();await page.waitForURL(`${origin}/research/${target.id}?engine=claude&profile=plan`);await page.getByRole('alert').filter({hasText:'Disposable native console unavailable'}).waitFor();assert.deepEqual(selections.at(-1),{provider:'claude',profile:'plan'});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   pass(`engine/profile, authentication, native restrictions, keyboard and navigation ${width}/${theme}`);
  }
  await page.goto(url);engines=engines.map(row=>({...row,authentication:row.provider==='codex'?'required':'authenticated',runningProfile:row.provider==='codex'?'yolo':null}));
  let launcher=page.locator(`[aria-label="Launcher for ${target.host}"]`);await launcher.locator('summary').filter({hasText:'Engine details'}).evaluate(e=>{e.parentElement.open=true;});await launcher.getByRole('button',{name:'Check readiness',exact:true}).click();await launcher.getByRole('status').filter({hasText:'Login required'}).waitFor();assert.equal(await launcher.getByLabel('Launch profile',{exact:true}).inputValue(),'yolo');
  await launcher.getByLabel('Launch profile',{exact:true}).selectOption('standard');await launcher.getByRole('alert').waitFor();assert.equal(await launcher.getByRole('link',{name:`Open console — ${target.host}`,exact:true}).count(),0);await launcher.getByRole('button',{name:'Use running yolo profile'}).click();
  await launcher.getByLabel('Engine',{exact:true}).selectOption('claude');assert.match(await launcher.getByRole('status').innerText(),/Authenticated/);pass('running profile conflict preserves session; Codex login required and Claude authenticated');
  engines=engines.map(row=>({...row,profiles:[],runningProfile:null}));await launcher.locator('summary').filter({hasText:'Engine details'}).evaluate(e=>{e.parentElement.open=true;});await launcher.getByRole('button',{name:'Check readiness',exact:true}).click();await launcher.getByLabel('Launch profile',{exact:true}).locator('option').first().waitFor({state:'detached'});assert.equal(await launcher.getByRole('link',{name:`Open console — ${target.host}`,exact:true}).count(),0);pass('unsupported profiles absent');
  unavailable=true;await page.goto(url);launcher=page.locator(`[aria-label="Launcher for ${target.host}"]`);await launcher.locator('summary').filter({hasText:'Engine details'}).evaluate(e=>{e.parentElement.open=true;});await launcher.getByRole('button',{name:'Check readiness',exact:true}).click();await launcher.getByRole('status').filter({hasText:'Authentication readiness unknown'}).waitFor();pass('unavailable readiness remains Unknown without breaking entry');unavailable=false;
  await page.goto(`${origin}/research/${target.id}?engine=codex&profile=plan`);await page.getByRole('alert').filter({hasText:'Unsupported engine or launch profile'}).waitFor();pass('direct invalid launch selection rejected');
  await prisma.researchSession.create({data:{userId:owner.id,targetId:target.id,consoleTargetId:target.id,workspaceId:`research_${target.id}`,targetHost:target.host,programName:program.companyName,scopeMarkdown:'Historical immutable snapshot',authorizationSnapshot:{old:true}}});
  await page.goto(url);launcher=page.locator(`[aria-label="Launcher for ${target.host}"]`);await launcher.getByRole('alert').filter({hasText:'Policy: stale'}).waitFor();assert.equal(await launcher.getByRole('link',{name:`Open console — ${target.host}`,exact:true}).count(),0);pass('stale snapshot blocks entry without rewriting policy');
  await prisma.scope.update({where:{id:scope.id},data:{status:'REVOKED'}});await page.goto(`${origin}/research/${target.id}`);await page.getByRole('alert').filter({hasText:'current scope authorization is required'}).waitFor();pass('revoked Scope refuses direct console');
  const anon=await context.browser().newContext();try{assert.equal((await anon.request.get(`${origin}/api/research-targets/${target.id}/launcher`)).status(),401);}finally{await anon.close();}
  assert.equal((await context.request.get(`${origin}/api/research-targets/missing/launcher`)).status(),404);pass('anonymous and missing readiness endpoint states');
  assert.deepEqual(errors,[]);pass('no browser exceptions');
 } finally {page.off('pageerror',onError);await context.unroute(pattern);await context.unroute(ticketPattern);await page.setViewportSize({width:1280,height:900});}
 console.log(`M7_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
