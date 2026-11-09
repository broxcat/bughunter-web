// Built application and disposable SQL/Redis only. No worker or inference.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {PrismaClient} from '@prisma/client';
import {chromium} from 'playwright-chromium';
const exec=promisify(execFile),db=process.env.TEST_DATABASE_URL,redis=process.env.TEST_ABUSE_REDIS_URL,container=process.env.TEST_ABUSE_REDIS_CONTAINER;
assert(db&&redis&&container,'Use tests/queue/runInfrastructure.mjs --browser-only --simplification-browser');
assert.equal((await exec('docker',['inspect','--format','{{index .Config.Labels "bughunter.queue-test"}}',container])).stdout.trim(),'disposable');
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const origin=`http://127.0.0.1:${port}`,url=new URL(db);url.searchParams.set('schema','simplification_'+randomUUID().replaceAll('-',''));
const env={...process.env,DATABASE_URL:url.toString(),REDIS_URL:redis,AUTH_URL:origin,AUTH_SECRET:randomUUID(),CREDENTIALS_ENCRYPTION_KEY:'ab'.repeat(32),LOG_LEVEL:'silent',RESEARCH_CONSOLE_ROOT:'/dev/shm/bh-ui-absent-console',RESEARCH_WORKSPACE_ROOT:'/dev/shm/bh-ui-absent-workspace',RESEARCH_TERMINAL_PRIVATE_KEY_FILE:'/dev/shm/bh-ui-absent-key',RESEARCH_TERMINAL_CONTROL_URL:'http://127.0.0.1:1'};
const p=new PrismaClient({datasourceUrl:env.DATABASE_URL}),phase=process.env.UI_REVIEW_PHASE??'after',root='/tmp/bughunter-ui-review/'+phase;await mkdir(root,{recursive:true});let web,browser,page;
const density=[];let checks=0;const verify=(condition,message)=>{assert(condition,message);checks++;};
try{
 await exec('npx',['prisma','migrate','deploy'],{env});const password=randomUUID(),owner=await p.user.create({data:{email:randomUUID()+'@example.test',passwordHash:await bcrypt.hash(password,10)}});
 const program=await p.bountyProgram.create({data:{ownerId:owner.id,companyName:'Acme Security',platform:'HACKERONE',programUrl:'https://example.test/program',requiredUserAgent:'Captured-Fixture/1',outOfScope:['excluded.example.test'],scopeRules:['app.example.test']}});
 const scope=await p.scope.create({data:{userId:owner.id,hostPattern:'app.example.test',status:'APPROVED'}}),asset=await p.scopeAsset.create({data:{programId:program.id,originalValue:'app.example.test',normalizedValue:'app.example.test',format:'SUBDOMAIN',type:'WEB_APPLICATION'}});
 const target=await p.target.create({data:{userId:owner.id,scopeId:scope.id,programId:program.id,scopeAssetId:asset.id,host:'app.example.test'}}),parent=await p.targetReconRun.create({data:{programId:program.id,status:'COMPLETED',outcome:'PARTIAL',startedAt:new Date(Date.now()-65000),finishedAt:new Date()}});
 const stages=[['Scope validation','COMPLETED'],['DNS','COMPLETED'],['HTTP surface','COMPLETED'],['Content discovery','PARTIAL'],['Ports / services','SKIPPED_NOT_APPLICABLE'],['Nuclei','FAILED']];
 const scan=await p.scanRun.create({data:{type:'RECON',targetId:target.id,scopeAssetId:asset.id,targetReconRunId:parent.id,status:'COMPLETED',outcome:'PARTIAL',requiredUserAgent:'Captured-Fixture/1',startedAt:new Date(Date.now()-65000),finishedAt:new Date(),scopeAssetSnapshot:{normalizedValue:asset.normalizedValue},reconPlan:{stages:stages.map(([name])=>({name,tools:['fixture-tool']}))},reconSteps:{create:stages.map(([name,state],position)=>({name,state,position,...(state==='PARTIAL'?{reason:'Fixture time budget exhausted'}:{})}))}}});
 await p.scanLog.create({data:{scanRunId:scan.id,stream:'STDOUT',line:'Fixture raw output'}});
 await p.reconArtifact.create({data:{scanRunId:scan.id,scopeAssetId:asset.id,kind:'endpoint',canonicalKey:'fixture-login',value:{url:'https://app.example.test/login',statusCode:200},scopeState:'IN_SCOPE',verification:'OBSERVED',sources:[],firstSeenAt:new Date(),lastSeenAt:new Date()}});
 const finding=await p.finding.create({data:{targetId:target.id,title:'Access control review',severity:'HIGH',reviewStatus:'CONFIRMED',gateStatus:'PASSED',description:'Retained finding description',evidence:'Retained proof'}});
 await p.report.create({data:{userId:owner.id,targetId:target.id,title:'Acme report',platform:'HACKERONE',markdown:'# Acme report\n\nRetained report body.',items:{create:{findingId:finding.id}}}});
 web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'ignore'});
 for(let i=0;;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i>150||web.exitCode!==null)throw Error('Web readiness');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext();let foreign=0;await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){foreign++;return route.abort();}return route.continue();});
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(origin+'/targets');
 const routes=[['targets','/targets?q=Acme'],['global-findings','/findings?q=Access'],['target','/targets/'+program.id],['scope','/scopes?target='+program.id],['asset','/scopes/'+asset.id],['recon','/recon?q=Acme'],['recon-history','/recon?program='+program.id],['recon-run','/recon/runs/'+parent.id],['research','/research?program='+program.id],['findings','/targets/'+program.id+'/findings'],['host-findings','/targets/'+target.id+'/findings'],['reports','/targets/'+program.id+'/report'],['settings','/settings'],['target-settings','/targets/'+program.id+'/settings'],['host','/hosts/'+target.id],['hunt','/hunt']];
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(v=>localStorage.setItem('theme',v),theme);
  for(const [name,path]of routes){const response=await page.goto(origin+path);verify(response.ok(),`${name} responds`);await page.locator('main h1').waitFor();await page.waitForTimeout(350);
   verify(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} ${theme} ${width} overflow`);
   verify(await page.locator('html').getAttribute('data-theme')===theme,'theme persists');
   const text=await page.locator('main').innerText();if(name==='recon'&&phase!=='before')verify(text.includes(asset.normalizedValue),'Recon inventory includes an asset or host');density.push({name,theme,width,words:text.split(/\s+/).length,controls:await page.locator('main :is(button,input,select,textarea,a):visible').count()});
   await page.screenshot({path:`${root}/${name}-${theme}-${width}.png`,fullPage:true});
  }
  await page.goto(origin+'/targets');
  verify(await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link').allTextContents().then(v=>JSON.stringify(v)===JSON.stringify(['Targets','Findings','Settings'])),'primary navigation is reduced');
  await page.getByRole(phase==='before'?'button':'link',{name:'Create target',exact:true}).click();
  if(phase==='before'){await page.screenshot({path:root+'/create-'+theme+'-'+width+'.png',fullPage:true});continue;}
  await page.getByRole('heading',{name:'Create target',exact:true}).waitFor();
  verify(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'new target form fits the viewport');
  await page.screenshot({path:root+'/create-'+theme+'-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:'Save and start',exact:true}).click();
  verify(await page.getByLabel('Name',{exact:true}).evaluate(e=>!e.validity.valid&&e===document.activeElement),'required validation focuses name');
  await page.getByLabel('Name',{exact:true}).fill('Keyboard '+theme+' '+width);
  await page.getByRole('button',{name:'Add asset',exact:true}).click();
  await page.getByLabel('Asset 1',{exact:true}).fill('new.example.test');
  await page.getByRole('button',{name:'Save and start',exact:true}).click();
  await page.waitForURL(/\/targets\/(?!new)[^/?]+$/);
  const createdId=new URL(page.url()).pathname.split('/').at(-1);
  const created=await p.bountyProgram.findUniqueOrThrow({where:{id:createdId}});
  verify(created.requiredUserAgent==='','no synthetic User-Agent is injected on creation');
  verify(await p.scopeAsset.count({where:{programId:createdId,active:true}})===1,'scope is saved with the target');
 }
 if(phase!=='before'){
  await page.goto(origin+'/targets');
  await page.getByRole('link',{name:'Create target',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Name only fixture');
  await page.getByRole('button',{name:'Save and start',exact:true}).click();
  await page.waitForURL(/\/targets\/(?!new)[^/?]+$/);
  const nameOnly=await p.bountyProgram.findUniqueOrThrow({where:{id:new URL(page.url()).pathname.split('/').at(-1)}});
  verify(nameOnly.platform===null&&nameOnly.programUrl===null,'platform and URL are optional');
  await page.goto(origin+'/targets/new');
  await page.getByLabel('Name',{exact:true}).fill('API error fixture');
  await page.route('**/api/programs',route=>route.request().method()==='POST'?route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Fixture validation error'})}):route.continue());
  await page.getByRole('button',{name:'Save and start',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Fixture validation error'}).waitFor();
  await page.unroute('**/api/programs');
  await page.getByRole('link',{name:'Cancel',exact:true}).click();
  await page.waitForURL(origin+'/targets');checks++;
  await page.goto(origin+'/targets/'+program.id);verify(!(await page.locator('main').innerText()).includes('Scope assets'),'Target home does not duplicate Scope');
  await page.goto(origin+'/scopes?target='+program.id);await page.getByRole('button',{name:'View scope.md',exact:true}).click();await page.getByRole('dialog').getByLabel('Current Target scope document').waitFor();await page.keyboard.press('Escape');checks++;
  await page.goto(origin+'/recon/runs/'+parent.id);const raw=page.locator('details').filter({has:page.locator('summary',{hasText:'Raw execution output'})});verify(await raw.getAttribute('open')===null,'raw output collapsed');await raw.locator('summary').focus();await page.keyboard.press('Enter');await raw.getByText('Fixture raw output',{exact:false}).waitFor();checks++;
  await page.goto(origin+'/targets/'+target.id+'/findings');const details=page.locator('details').filter({has:page.locator('summary',{hasText:'Access control review'})});verify(await details.getAttribute('open')===null,'finding evidence collapsed');await details.locator(':scope > summary').click();await details.getByText('Retained finding description',{exact:true}).waitFor();checks++;
 }
 verify(errors.length===0,errors.join('\n'));verify(foreign===0,'no external browser requests');await writeFile(root+'/density.json',JSON.stringify(density,null,2));console.log(`UI_SIMPLIFICATION_${phase.toUpperCase()}: ${checks} passed; ${routes.length*4} route/theme/viewport reviews; screenshots ${root}`);
}finally{await browser?.close();if(web&&web.exitCode===null){const end=new Promise(r=>web.once('exit',r));web.kill('SIGTERM');const timer=setTimeout(()=>web.kill('SIGKILL'),3000);await end;clearTimeout(timer);}await p.$disconnect();}
