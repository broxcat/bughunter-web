import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function auditMilestone5Scope({prisma:p,owner,origin,context,page,otherContext}) {
 let checks=0;
 const check=(name,work)=>{work();checks++;console.log(`M5_SCOPE_PASS ${checks}: ${name}`);};
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.evaluate(v=>localStorage.setItem('theme',v),theme);await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width,height:900});
  const program=await p.bountyProgram.create({data:{ownerId:owner.id,companyName:`M5 ${theme} ${width}`,requiredUserAgent:'M5-UA/1',outOfScope:['excluded.m5.test'],rulesOfEngagement:'No destructive testing'}});
  const scope=await p.scope.create({data:{userId:owner.id,hostPattern:'app.m5.test',status:'APPROVED',justification:'M5 explicit local fixture',accessInfo:'password=PRIVATE_M5_ACCESS'}});
  const asset=await p.scopeAsset.create({data:{programId:program.id,originalValue:'app.m5.test',normalizedValue:'app.m5.test',format:'SUBDOMAIN',type:'WEB_APPLICATION'}});
  const target=await p.target.create({data:{userId:owner.id,programId:program.id,scopeId:scope.id,scopeAssetId:asset.id,host:'app.m5.test'}});
  const url=`${origin}/api/programs/${program.id}/scope.md`;
  await page.goto(`${origin}/targets/${program.id}`);const view=page.getByRole('button',{name:'View scope.md',exact:true});await view.waitFor();
  const initialPublications=await p.targetScopeContext.count({where:{programId:program.id}});check(`${theme}/${width}: Target render does not generate scope context`,()=>assert.equal(initialPublications,0));
  await view.focus();await page.keyboard.press('Enter');let dialog=page.getByRole('dialog',{name:'Current Target scope.md',exact:true}),document=dialog.getByLabel('Current Target scope document');await document.waitFor();
  let text=await document.innerText();check(`${theme}/${width}: keyboard view, current authority, no-Recon and secrets`,()=>{assert(text.includes('## Authorization'));assert(text.includes('app\\.m5\\.test'));assert(text.includes('NOT_STARTED'));assert(!text.includes('PRIVATE_M5_ACCESS'));assert(text.includes('M5\\-UA/1'));});
  const fit=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert(fit);await document.focus();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await view.evaluate(el=>el===window.document.activeElement));
  check(`${theme}/${width}: modal keyboard exit/focus restoration and viewport`,()=>assert(fit));
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download scope.md',exact:true}).click()]);const downloaded=await readFile(await download.path(),'utf8');check(`${theme}/${width}: actual Markdown download and stable revision`,()=>{assert(download.suggestedFilename().endsWith('-scope.md'));assert.equal(downloaded,text);});
  const second=await p.scopeAsset.create({data:{programId:program.id,originalValue:'api.m5.test',normalizedValue:'api.m5.test',format:'SUBDOMAIN',type:'API'}});
  const secondScope=await p.scope.create({data:{userId:owner.id,hostPattern:'api.m5.test',status:'APPROVED'}}),secondTarget=await p.target.create({data:{userId:owner.id,programId:program.id,scopeId:secondScope.id,scopeAssetId:second.id,host:'api.m5.test'}});
  const excluded=await p.scopeAsset.create({data:{programId:program.id,originalValue:'excluded.m5.test',normalizedValue:'excluded.m5.test',format:'SUBDOMAIN',type:'WEB_APPLICATION'}});
  const updated=await context.request.patch(`${origin}/api/programs/${program.id}`,{data:{requiredUserAgent:'M5-UA/2'}});assert.equal(updated.status(),200);
  async function run(a,t,outcome){return p.scanRun.create({data:{targetId:t.id,scopeAssetId:a.id,type:'RECON',status:'COMPLETED',outcome,requiredUserAgent:'M5-UA/2',finishedAt:new Date(),scopeAssetSnapshot:{assetId:a.id,programId:program.id,normalizedValue:a.normalizedValue,format:a.format},reconPlan:{boundary:{normalizedValue:a.normalizedValue},authorization:{exclusions:['excluded.m5.test']},stages:[],activityMode:'PASSIVE'},reconSteps:{create:{name:'HTTP surface',position:0,state:outcome==='PARTIAL'?'PARTIAL':'COMPLETED',reason:outcome==='PARTIAL'?'Fixture budget exhausted':null}}}});}
  const partial=await run(asset,target,'PARTIAL');const artifact=await p.reconArtifact.create({data:{scanRunId:partial.id,scopeAssetId:asset.id,kind:'observation',canonicalKey:'dns',verification:'OBSERVED',scopeState:'OUT_OF_SCOPE',sources:[{tool:'dnsx'}],value:{type:'dns-address',hostname:'discovered.m5.test',recordType:'A',addresses:['192.0.2.5']},firstSeenAt:new Date(),lastSeenAt:new Date()}});
  await view.click();await document.waitFor();text=await document.innerText();const auth=text.split('## Authorized Assets')[1].split('## Exclusions')[0];
  check(`${theme}/${width}: multi-host partial context, real provenance and exclusions`,()=>{assert(text.includes('Aggregate current coverage: PARTIAL'));assert(text.includes('NOT\\_STARTED'));assert(text.includes(partial.id));assert(text.includes(artifact.id));assert(text.includes('M5\\-UA/2'));assert(text.includes('192\\.0\\.2\\.5'));assert(!auth.includes('excluded'));assert(!auth.includes('discovered'));assert(auth.includes('api\\.m5\\.test'));});await page.keyboard.press('Escape');
  const retired=await context.request.delete(`${origin}/api/programs/${program.id}/assets/${excluded.id}`,{data:{expectedUpdatedAt:excluded.updatedAt.toISOString()}});assert.equal(retired.status(),200);
  await run(asset,target,'SUCCESS');await run(second,secondTarget,'SUCCESS');
  const complete=await context.request.get(url),completeText=await complete.text();check(`${theme}/${width}: complete per-host coverage after meaningful policy revision`,()=>{assert.equal(complete.status(),200);assert(completeText.includes('Aggregate current coverage: COMPLETE'));assert(!completeText.includes(excluded.id));});
  const replace=await context.request.post(`${origin}/api/programs/${program.id}/assets/${second.id}`,{data:{value:'replacement.m5.test',confirmReplacement:true,expectedUpdatedAt:second.updatedAt.toISOString(),assetValue:'MEDIUM'}});assert.equal(replace.status(),201);
  const replaced=await context.request.get(url),replacement=await replaced.text();check(`${theme}/${width}: replacement updates current identity, preserves historical run`,()=>{assert(replacement.includes('replacement\\.m5\\.test'));assert(!replacement.includes(second.id));assert(replacement.includes('Aggregate current coverage: PARTIAL'));});assert(await p.scanRun.findFirst({where:{scopeAssetId:second.id}}));
  const foreign=await otherContext.request.get(url),missing=await context.request.get(`${origin}/api/programs/missing-m5/scope.md`);
  check(`${theme}/${width}: owner isolation and stale bookmarks`,()=>{assert.equal(foreign.status(),404);assert.equal(missing.status(),404);});
  let intercepted=0;await page.route(url,async route=>{if(intercepted++===0)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic publication failure"}'});return route.continue();});
  await view.click();await dialog.getByRole('alert').waitFor();await dialog.getByRole('button',{name:'Retry',exact:true}).click();await document.waitFor();assert((await document.innerText()).includes('replacement\\.m5\\.test'));await page.keyboard.press('Escape');await page.unroute(url);
  check(`${theme}/${width}: concise publication error and keyboard-safe retry`,()=>assert(intercepted>=2));
  const callsBefore=await p.scanRun.count({where:{target:{programId:program.id}}});await page.reload();await view.waitFor();const callsAfter=await p.scanRun.count({where:{target:{programId:program.id}}});
  check(`${theme}/${width}: refresh does not launch Recon or change Scope`,()=>assert.equal(callsAfter,callsBefore));
 }
 console.log(`M5_SCOPE_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
