import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,readdir,writeFile,chown} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {Worker} from 'bullmq';
import {Redis} from 'ioredis';
import {chromium} from 'playwright-chromium';
import {prisma} from '@/lib/prisma';
import {researchPlanState} from '@/server/research/plans';
import {encryptSecret} from '@/lib/crypto';
import {createScopeAsset,ensureAssetExecution} from '@/server/scopeAssets';
import {testStoredConnection} from '@/server/credentials/connection';
import {startTargetRecon,reconcileTargetRecon} from '@/server/recon/targetRuns';
import {createScanProcessor} from '@/server/queue/processScan';
import {SCAN_QUEUE_NAME,type ScanJobData} from '@/server/queue/scanQueue';
import {readAuthSurface} from '@/server/authenticatedRecon';
import {generateReconSnapshot} from '@/server/research/reconSnapshots';
import {captureAuthenticatedContexts} from '@/server/authenticatedRecon';
import {loadTargetExecution,withTargetExecution} from '@/server/execution';
import {mapAuthenticatedSurfaces} from '@/server/recon/authenticatedMapping';
import {buildReconPlan} from '@/lib/reconPlanner';
import {assetAllowsUrl} from '@/lib/scopeAssets';
import type {Prisma} from '@prisma/client';
import {setAssessmentMode} from '@/server/assessment';
import {fixtureAccounts} from './authenticatedFixture.mjs';

assert.equal(process.env.BH_DISPOSABLE_AUTH_RECON,'1');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/authenticated_recon_test');
const base='http://auth.fixture.test:8081/app/',native=process.env.AUTH_RECON_NATIVE==='true',browserEnabled=process.env.AUTH_RECON_BROWSER==='true';
const metadata=(phase:string,fields:Record<string,unknown>)=>console.log(JSON.stringify({acceptance:'authenticated-recon',phase,...fields}));
const secretMarkers=Object.values(fixtureAccounts).flatMap(account=>[account.password,account.cookie,account.bearer]);
const privateFree=(value:unknown)=>{const text=JSON.stringify(value);for(const marker of secretMarkers)assert(!text.includes(marker),'Credential material escaped a private authentication boundary');};
const seen=async()=>await(await fetch('http://auth.fixture.test:8081/__observations')).json() as {host:string;path:string;method:string;role:string|null;hasCookie:boolean;hasAuthorization:boolean;ua:string}[];
const authPath=(targetId:string)=>'/api/targets/'+targetId+'/credentials';
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,web:ReturnType<typeof spawn>|undefined,worker:Worker<ScanJobData>|undefined;
let processor:ReturnType<typeof createScanProcessor>|undefined,connection:Redis|undefined;
const failures:string[]=[];
// Inspect real scanner process argv/env in the disposable application container.
// Passwords intentionally exist only inside the existing login process memory.
let polling=false;
const inspectProcesses=async()=>{if(polling)return;polling=true;try{for(const id of(await readdir('/proc')).filter(value=>/^\d+$/.test(value))){try{const cmd=await readFile('/proc/'+id+'/cmdline','utf8');if(!/(?:^|\0)(?:[^\0]*\/)?(?:httpx|nmap|ffuf|gobuster|nuclei)(?:\0|$)/.test(cmd))continue;const env=await readFile('/proc/'+id+'/environ','utf8');for(const marker of secretMarkers)if(cmd.includes(marker)||env.includes(marker))failures.push('Scanner credential argv/environment leak');}catch{/* A process can exit between /proc reads. */}}}finally{polling=false;}};
const processMonitor=setInterval(()=>void inspectProcesses(),10);
try{
  for(let attempt=0;;attempt++){try{if((await fetch(base)).ok)break;}catch{}assert(attempt<100,'Controlled fixture unavailable');await new Promise(r=>setTimeout(r,100));}
  const password=randomUUID(),owner=await prisma.user.create({data:{email:randomUUID()+'@example.test',passwordHash:await bcrypt.hash(password,4)}});
  if(native){
    connection=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:null});connection.on('error',()=>{});processor=createScanProcessor('authenticated-native-fixture');
    worker=new Worker<ScanJobData>(SCAN_QUEUE_NAME,(job,token,signal)=>processor!.process(job,signal,token),{connection,concurrency:1});worker.on('error',()=>{});await worker.pause(true);
    const cases=[];
    for(const assessmentMode of ['BLACK_BOX','WHITE_BOX'] as const){
      const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Authenticated native '+assessmentMode,requiredUserAgent:'Auth-Recon-Fixture/'+assessmentMode,assessmentMode}});
      const asset=await createScopeAsset(owner.id,program.id,{value:base,type:'WEB_APPLICATION',assetValue:'MEDIUM'}),{target}=await ensureAssetExecution(owner.id,program.id,asset.id);
      const user=await prisma.targetCredential.create({data:{targetId:target.id,label:'User session',mode:'EMAIL_PASSWORD',purpose:'ACCOUNT_A',persona:'User',emailCipher:encryptSecret(fixtureAccounts.user.username),passwordCipher:encryptSecret(fixtureAccounts.user.password)}});
      assert.equal((await testStoredConnection(target.id,user.id)).status,'VALID','Existing login workflow must establish a real local session');
      const manager=await prisma.targetCredential.create({data:{targetId:target.id,label:'Manager token',mode:'BEARER',purpose:'ACCOUNT_B',persona:'Manager',headerCipher:encryptSecret(fixtureAccounts.manager.bearer)}});
      assert.equal((await testStoredConnection(target.id,manager.id)).status,'VALID','Existing bearer verification must establish local identity');
      const duplicate=await prisma.targetCredential.create({data:{targetId:target.id,label:'Same user identity',mode:'COOKIES',purpose:'OTHER',cookiesCipher:encryptSecret(JSON.stringify({fixture_session:fixtureAccounts.user.cookie}))}});
      assert.equal((await testStoredConnection(target.id,duplicate.id)).status,'VALID');
      await prisma.targetCredential.updateMany({where:{id:{in:[user.id,manager.id,duplicate.id]}},data:{reconEnabled:true}});
      const expired=await prisma.targetCredential.create({data:{targetId:target.id,label:'Expired session',mode:'COOKIES',reconEnabled:true,sessionStatus:'VALID',sessionCheckedAt:new Date(0),sessionExpiresAt:new Date(1),cookiesCipher:encryptSecret(JSON.stringify({fixture_session:fixtureAccounts.temporary.cookie}))}});
      await prisma.targetCredential.create({data:{targetId:target.id,label:'Disabled session',mode:'COOKIES',reconEnabled:false,cookiesCipher:encryptSecret(JSON.stringify({fixture_session:fixtureAccounts.temporary.cookie}))}});
      const parent=await startTargetRecon(owner.id,program.id),scan=await prisma.scanRun.findFirstOrThrow({where:{targetReconRunId:parent.id}});
      const snapshot=scan.authenticatedContextsSnapshot as {contexts:{credentialId:string;eligibility:string;contextKey:string}[]};assert.equal(snapshot.contexts.length,4);
      assert.equal(snapshot.contexts.find(c=>c.credentialId===duplicate.id)?.eligibility,'AUTH_CONTEXT_DUPLICATE_IDENTITY');assert.equal(snapshot.contexts.find(c=>c.credentialId===expired.id)?.eligibility,'SESSION_UNAVAILABLE');
      // Changing descriptive metadata after queueing must not rewrite this run.
      await prisma.targetCredential.update({where:{id:user.id},data:{persona:'Changed after capture'}});
      await prisma.targetCredential.update({where:{id:duplicate.id},data:{reconEnabled:false}});
      await setAssessmentMode(owner.id,program.id,assessmentMode==='BLACK_BOX'?'WHITE_BOX':'BLACK_BOX',true);
      const immutable=await prisma.scanRun.findUniqueOrThrow({where:{id:scan.id}});assert.deepEqual(immutable.authenticatedContextsSnapshot,scan.authenticatedContextsSnapshot);assert.equal(immutable.assessmentModeSnapshot,assessmentMode);
      cases.push({program,asset,target,parent,scan,user,manager,snapshot});
    }
    const before=await seen(),loginCount=before.filter(row=>row.method==='POST').length;await worker.resume();
    for(const test of cases){
      let scan;const deadline=Date.now()+480000;
      for(;;){scan=await prisma.scanRun.findUniqueOrThrow({where:{id:test.scan.id},include:{artifacts:true,reconSteps:true}});if(!['QUEUED','RUNNING'].includes(scan.status))break;assert(Date.now()<deadline,'Authenticated Recon deadline');await new Promise(r=>setTimeout(r,200));}
      if(scan.status!=='COMPLETED'||scan.outcome!=='SUCCESS')await writeFile('/acceptance/native-failure.json',JSON.stringify({status:scan.status,outcome:scan.outcome,error:scan.error,steps:scan.reconSteps,logs:await prisma.scanLog.findMany({where:{scanRunId:scan.id},orderBy:{id:'desc'},take:80,select:{line:true}})}),{mode:0o600});
      assert.equal(scan.status,'COMPLETED');assert.equal(scan.outcome,'SUCCESS');await reconcileTargetRecon(test.parent.id);
      const [surface]=await readAuthSurface([scan.id]);await writeFile('/acceptance/native-surface.json',JSON.stringify(surface),{mode:0o600});assert.equal(surface.legacy,false);assert(surface.contexts.some(context=>context.persona==='User'),'Captured persona must remain unchanged');
      const paths=surface.surfaceVisibility;
      assert(paths.some(row=>new URL(row.url).pathname==='/app/public'&&row.classifications.includes('PUBLIC')));
      assert(paths.some(row=>new URL(row.url).pathname==='/app/dashboard'&&row.classifications.includes('AUTHENTICATED_ONLY')));
      assert(paths.some(row=>new URL(row.url).pathname==='/app/admin'&&row.classifications.includes('CONTEXT_DIFFERENTIAL')),'User403 vs manager200 must be an observation, never a Finding');
      assert(surface.observations.every(row=>['GET','HEAD'].includes(row.method)&&assetAllowsUrl(test.asset,row.url)));
      assert(surface.contexts.some(context=>context.state==='AUTH_CONTEXT_DUPLICATE_IDENTITY'));assert(surface.contexts.some(context=>context.state==='SKIPPED_SESSION_UNAVAILABLE'));
      assert.equal(await prisma.finding.count({where:{targetId:test.target.id}}),0);
      const researchPlan=(await researchPlanState(owner.id,test.target.id)).plan;assert(researchPlan);
      const authorization=researchPlan.items.find(item=>item.category==='AUTHORIZATION'&&item.surfaceRefs.some(ref=>new URL(ref.url).pathname==='/app/admin'));
      assert(authorization&&authorization.priority==='HIGH');assert(authorization.evidenceRefs.some(ref=>ref.startsWith('ReconSurfaceObservation:')));
      assert.equal(researchPlan.assessmentMode,test.program.assessmentMode);assert.equal(researchPlan.sourceAnalysisPerformed,false);privateFree(researchPlan);
      assert.equal(await prisma.researchHypothesis.count(),0);assert.equal(await prisma.aiProviderConfig.count(),0);
      metadata('research-plan',{status:'PASS',assessmentMode:researchPlan.assessmentMode,objectives:researchPlan.items.length,high:researchPlan.items.filter(item=>item.priority==='HIGH').length,evidenceRefs:authorization.evidenceRefs,sourceAnalysisPerformed:false,hypothesesCreated:0,findingsCreated:0,modelCalls:0});
      const full=await prisma.scanRun.findUniqueOrThrow({where:{id:scan.id}});assert(full.scopeMarkdown?.includes('Observed Authentication Contexts'));privateFree(full.scopeMarkdown);privateFree(surface);
      assert.deepEqual(full.authenticatedContextsSnapshot,test.scan.authenticatedContextsSnapshot);assert.equal(full.assessmentModeSnapshot,test.program.assessmentMode);
      const snapshot=await generateReconSnapshot(owner.id,test.target.id);assert(snapshot.snapshot);privateFree(snapshot.snapshot);
      const detail=(await prisma.researchReconSnapshot.findUniqueOrThrow({where:{id:snapshot.snapshot.id}})).context;privateFree(detail);
      assert(JSON.stringify(detail).includes('CONTEXT_DIFFERENTIAL'),'The immutable Research detail file must include safe context intelligence');
      assert(!JSON.stringify(detail).includes('User session')&&!JSON.stringify(detail).includes('Manager token'),'Research exports opaque labels, not credential record labels');
      const logs=await prisma.scanLog.findMany({where:{scanRunId:scan.id},select:{line:true}});privateFree(logs);
      assert(logs.some(row=>row.line.startsWith('$ httpx ')),'Real native HTTPX must run');assert(logs.some(row=>row.line.startsWith('$ gobuster ')||row.line.startsWith('$ ffuf ')),'Real native content provider must run');
      assert(logs.some(row=>row.line.startsWith('$ nuclei ')),'Real allowlisted native Nuclei must run');
      assert(!logs.some(row=>row.line.startsWith('$ ')&&/\b(?:Cookie:|Authorization:)/i.test(row.line)),'Scanner commands must never receive authentication headers');
      assert.equal(await prisma.researchReconDelivery.count(),0);metadata('native',{status:'PASS',assessmentMode:test.program.assessmentMode,contexts:surface.contexts.length,observations:surface.observations.length,differentials:surface.totals.contextDifferentials,toolchain:'actual-installed-native-binaries',scopeMarkdown:true,researchSnapshot:true,immutableRunSnapshot:true});
    }
    assert.equal((await seen()).filter(row=>row.method==='POST').length,loginCount,'Recon must not invoke the explicit login workflow');
    await worker.pause(true);
    const test=cases[0],snapshot=await prisma.$transaction(tx=>captureAuthenticatedContexts(tx,test.target.id));
    const plan=buildReconPlan(test.asset,{active:true,exclusions:[]},{authenticatedContexts:2});
    const mappingScan=await prisma.scanRun.create({data:{targetId:test.target.id,scopeAssetId:test.asset.id,type:'RECON',status:'RUNNING',authenticatedContextsSnapshot:snapshot as unknown as Prisma.InputJsonValue}});
    await fetch('http://auth.fixture.test:8081/__control',{method:'POST',body:JSON.stringify({expire:'user'})});
    const execution=await loadTargetExecution(test.target.id),lost=await withTargetExecution(execution,()=>mapAuthenticatedSurfaces({scanRunId:mappingScan.id,scopeAssetId:test.asset.id,snapshot,plan,signal:new AbortController().signal,seeds:[base],budget:{remaining:plan.authenticatedMapping!.maxRequests},browser:false}));
    const userContext=snapshot.contexts.find(context=>context.credentialId===test.user.id)!;
    assert(lost.contexts.some(context=>context.contextKey===userContext.contextKey&&context.state==='SKIPPED_SESSION_LOST'),'A remote session loss must stop its context without anonymous downgrade');
    assert(lost.contexts.some(context=>context.contextKey!==userContext.contextKey&&context.state==='COMPLETED'),'Other valid contexts must survive a lost session');
    await prisma.scanRun.update({where:{id:mappingScan.id},data:{status:'COMPLETED',outcome:'PARTIAL',authenticatedReconResult:lost as unknown as Prisma.InputJsonValue}});
    await fetch('http://auth.fixture.test:8081/__control',{method:'POST',body:JSON.stringify({restore:'user'})});
    privateFree(lost);metadata('session-loss',{status:'PASS',transport:'actual-guarded-native-GET',state:'SKIPPED_SESSION_LOST',otherContextsPreserved:true,loginInvoked:false});
  }
  if(browserEnabled){
    const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Authentication browser fixture',requiredUserAgent:'Auth-UI-Fixture/1'}});
    const asset=await createScopeAsset(owner.id,program.id,{value:base,type:'WEB_APPLICATION',assetValue:'LOW'}),{target}=await ensureAssetExecution(owner.id,program.id,asset.id);
    const origin='http://127.0.0.1:3000';web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3000'],{env:{...process.env,AUTH_URL:origin,ALLOW_PUBLIC_REGISTRATION:'false'},stdio:'ignore'});
    for(let attempt=0;;attempt++){assert(web.exitCode===null,'Isolated web exited');try{if((await fetch(origin+'/api/health')).ok)break;}catch{}assert(attempt<150,'Isolated web readiness');await new Promise(r=>setTimeout(r,100));}
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const page=await context.newPage();const errors:string[]=[];page.on('pageerror',()=>errors.push('pageerror'));
    await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill(owner.email!);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(origin+'/targets');await page.goto(origin+'/hosts/'+target.id);
    const authentication=page.locator('#authentication');await authentication.getByRole('heading',{name:'Authentication',exact:true}).waitFor();
    await authentication.getByRole('radio',{name:'Session cookie',exact:true}).check();await authentication.getByLabel('Session cookie value',{exact:true}).fill('fixture_session='+fixtureAccounts.user.cookie);
    await authentication.getByRole('button',{name:'Test connection',exact:true}).click();await authentication.getByText('✓ Connected — Session valid',{exact:true}).waitFor();
    const first=authentication.getByRole('region',{name:'Saved authentication Account 1',exact:true});await first.waitFor();assert.equal(await first.getByRole('switch').isChecked(),false);await first.getByText(/Last verified:/).waitFor();assert(!await first.getByText(/Last verified: Not established/).count());
    await first.getByLabel('Persona for Account 1',{exact:true}).fill('User');await first.getByRole('button',{name:'Save persona',exact:true}).click();await first.getByRole('button',{name:'Save persona',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[aria-label="Persona for Account 1"]')?.value==='User');
    const enabled=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith('/credentials'));void enabled.catch(()=>{});await first.getByRole('switch').click();assert.equal((await enabled).status(),200);await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[aria-label="Use for Recon for Account 1"]')?.checked===true);await page.reload();assert(await first.getByRole('switch').isChecked());assert.equal(await first.getByLabel('Persona for Account 1',{exact:true}).inputValue(),'User');
    await authentication.getByRole('radio',{name:'Bearer token',exact:true}).check();await authentication.getByLabel('Bearer token value',{exact:true}).fill(fixtureAccounts.manager.bearer);await authentication.getByRole('button',{name:'Test connection',exact:true}).first().click();
    const second=authentication.getByRole('region',{name:'Saved authentication Account 2',exact:true});await second.waitFor();assert.equal(await second.getByRole('switch').isChecked(),false);
    const response=await context.request.get(origin+authPath(target.id));assert.equal(response.status(),200);const body=await response.json();privateFree(body);for(const row of body.credentials)for(const key of ['validationUrl','sessionIdentityHash','sessionCheckId','cookiesCipher','headerCipher','sessionCookiesCipher','emailCipher','passwordCipher'])assert(!(key in row),'Private verification evidence leaked to browser metadata');
    const captured=await prisma.$transaction(tx=>captureAuthenticatedContexts(tx,target.id));await prisma.scanRun.create({data:{targetId:target.id,scopeAssetId:asset.id,type:'RECON',status:'COMPLETED',outcome:'SUCCESS',authenticatedContextsSnapshot:captured as unknown as Prisma.InputJsonValue}});
    const detailResponse=await context.request.get(origin+'/api/targets/'+target.id);assert.equal(detailResponse.status(),200);const detailBody=await detailResponse.json();assert.equal(detailBody.scanRejection,null);for(const run of detailBody.scanRuns)assert(!('authenticatedContextsSnapshot'in run),'Host detail API leaked private captured authentication state');
    const listResponse=await context.request.get(origin+'/api/scan-runs?targetId='+target.id);assert.equal(listResponse.status(),200);for(const run of await listResponse.json())assert(!('authenticatedContextsSnapshot'in run),'Scan list API leaked private captured authentication state');
    const saved=await prisma.targetCredential.findFirstOrThrow({where:{targetId:target.id,label:'Account 1'}});assert(saved.sessionIdentityHash);assert(!(await authentication.innerText()).includes(saved.sessionIdentityHash));assert.equal(await authentication.getByLabel('Bearer token value',{exact:true}).inputValue(),'');
    assert.equal((await context.request.patch(origin+authPath(target.id),{headers:{Origin:'https://foreign.example.test'},data:{credentialId:saved.id,reconEnabled:false}})).status(),403);
    assert.equal((await context.request.patch(origin+authPath(target.id),{headers:{Origin:origin},data:{credentialId:saved.id,persona:'Invalid\r\nPersona'}})).status(),400);
    const stranger=await prisma.user.create({data:{email:randomUUID()+'@example.test',passwordHash:await bcrypt.hash(password,4)}}),foreign=await browser.newContext(),foreignPage=await foreign.newPage();
    await foreignPage.goto(origin+'/login');await foreignPage.getByLabel('Email',{exact:true}).fill(stranger.email!);await foreignPage.getByLabel('Password',{exact:true}).fill(password);await foreignPage.getByRole('button',{name:'Sign in',exact:true}).click();await foreignPage.waitForURL(origin+'/targets');
    assert.equal((await foreign.request.get(origin+authPath(target.id))).status(),404);assert.equal((await foreign.request.patch(origin+authPath(target.id),{headers:{Origin:origin},data:{credentialId:saved.id,reconEnabled:true}})).status(),404);assert.equal((await foreign.request.delete(origin+authPath(target.id)+'?credentialId='+saved.id,{headers:{Origin:origin}})).status(),404);await foreign.close();
    await prisma.targetCredential.update({where:{id:saved.id},data:{sessionExpiresAt:new Date(0)}});await page.reload();await first.getByText(/verified, unexpired session is required/).waitFor();const disabled=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith('/credentials'));void disabled.catch(()=>{});await first.getByRole('switch').click();assert.equal((await disabled).status(),200);await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[aria-label="Use for Recon for Account 1"]')?.checked===false);
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Authentication UI overflows mobile');await page.screenshot({path:'/acceptance/authentication.png',fullPage:true});assert.deepEqual(errors,[]);metadata('browser',{status:'PASS',cookieAndBearerVerified:true,optInDefault:false,personaPersisted:true,expiryVisible:true,safeMetadata:true,mobile:true});
  }
  const records=await seen();assert(records.some(row=>row.role==='user')&&records.some(row=>row.role==='manager'),'Both fixture identities must have made real verified requests');assert(records.every(row=>row.host==='auth.fixture.test:8081'&&row.path.startsWith('/app/')),'Scope redirect or sibling boundary was crossed');assert(!records.some(row=>/\/(?:logout|delete|transfer)$/.test(row.path)),'An action link was followed');assert(records.every(row=>['GET','HEAD'].includes(row.method)||row.path==='/app/login'&&row.method==='POST'),'Recon sent a mutating request');assert.deepEqual(failures,[]);assert.equal(await prisma.aiProviderConfig.count(),0);assert.equal(await prisma.reconSummary.count(),0);metadata('isolation',{status:'PASS',requests:records.length,foreignRedirectRequests:0,actionRequests:0,credentialProcessLeaks:0,publicRequests:0,modelCalls:0});
}finally{clearInterval(processMonitor);await browser?.close();if(web&&web.exitCode===null){const done=new Promise(resolve=>web!.once('exit',resolve));web.kill('SIGTERM');const timer=setTimeout(()=>web!.kill('SIGKILL'),3000);await done;clearTimeout(timer);}processor?.stopAccepting();await processor?.shutdown();await worker?.close(true);connection?.disconnect();await prisma.$disconnect();await writeFile('/acceptance/completed','fixture-cleanup-completed');const uid=Number(process.env.AUTH_RECON_OUTPUT_UID),gid=Number(process.env.AUTH_RECON_OUTPUT_GID);if(Number.isInteger(uid)&&Number.isInteger(gid))for(const name of await readdir('/acceptance'))await chown('/acceptance/'+name,uid,gid);}
process.exit(0);
