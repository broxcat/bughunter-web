import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

// Executed in the browser for every existing page/theme/viewport combination.
// These are rendered-behaviour checks, not a second theme implementation.
export function inspectVisualSurface(){
 const issues=[],visible=e=>e.checkVisibility({visibilityProperty:true}),css=getComputedStyle(document.documentElement);
 const rgba=v=>v.match(/[\d.]+/g)?.map(Number);
 // Resolve CSS colours through a real element, including hex/alpha tokens.
 const probe=document.createElement('span');document.body.append(probe);
 const resolve=token=>{probe.style.color=css.getPropertyValue(token);return rgba(getComputedStyle(probe).color);};
 const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const blend=(a,b)=>{const alpha=a[3]??1;return a.slice(0,3).map((v,i)=>v*alpha+b[i]*(1-alpha));};
 const actualBackground=e=>{const layers=[];for(let n=e;n;n=n.parentElement){const c=rgba(getComputedStyle(n).backgroundColor);if(c)layers.unshift(c);}return layers.reduce((bg,c)=>blend(c,bg),[255,255,255]);};
 const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
 const theme=document.documentElement.dataset.theme,background=resolve('--bg'),brand=resolve('--brand');probe.remove();
 if(theme==='light'&&luminance(background)<.9)issues.push('light canvas is not near-white');
 if(theme==='dark'&&luminance(background)>.04)issues.push('dark canvas is not charcoal');
 if(!(brand[0]>brand[1]*1.4&&brand[0]>brand[2]*1.4))issues.push('brand accent is not red');
 if(css.colorScheme!==theme)issues.push('native control colour scheme differs from selected theme');
 const main=document.querySelector('main.workspace-ui');
 if(main){
  const nav=document.querySelector('nav[aria-label="Primary navigation"]');
  const paths=Array.from(nav?.querySelectorAll('a')??[]).map(a=>a.pathname);
  if(JSON.stringify(paths)!==JSON.stringify(['/targets','/recon','/scopes','/research','/settings']))issues.push('primary navigation contains absent/duplicate routes');
  const active=nav?.querySelectorAll('[aria-current="page"]')??[];
  if(active.length!==1)issues.push('page lacks one active primary navigation context');
  if(active.length===1&&parseFloat(getComputedStyle(active[0]).borderBottomWidth)<2)issues.push('active state relies only on colour');
  const skip=document.querySelector('a[href="#main-content"]');if(!skip||main.id!=='main-content'||main.tabIndex!==-1)issues.push('skip destination unavailable');
  if(!Array.from(main.querySelectorAll('h1')).some(visible))issues.push('page title missing');
 }
 for(const button of document.querySelectorAll('.ui-btn')){
  if(!visible(button))continue;const s=getComputedStyle(button);
  if(button.getBoundingClientRect().height<31||parseFloat(s.paddingInlineStart)<7)issues.push('inconsistent button size: '+button.textContent.trim());
 }
 for(const e of document.querySelectorAll('.workspace-ui input,.workspace-ui select,.workspace-ui textarea,.auth-ui input,.ui-dialog input')){
  if(!visible(e)||e.disabled||e.type==='hidden'||['checkbox','radio'].includes(e.type))continue;
  const s=getComputedStyle(e),fg=rgba(s.color),bd=rgba(s.borderTopColor);
  const actualFill=actualBackground(e);
  if(fg&&contrast(blend(fg,actualFill),actualFill)<4.49)issues.push('control text contrast: '+(e.name||e.getAttribute('aria-label')));
  if(bd&&contrast(blend(bd,actualFill),actualFill)<2.99)issues.push('control boundary contrast: '+(e.name||e.getAttribute('aria-label')));
 }
 for(const table of document.querySelectorAll('main.workspace-ui table')){
  if(!visible(table))continue;const region=table.closest('.ui-table-scroll');
  if(!region||region.tabIndex!==0||region.getAttribute('role')!=='region'||!region.getAttribute('aria-label'))issues.push('table has no named keyboard scroll region');
 }
 return issues;
}

export async function auditMilestone6Interactions({prisma:p,owner,origin,page}){
 let checks=0;await mkdir('/tmp/bh-m6/screenshots',{recursive:true});
 const verify=name=>{checks++;console.log(`M6_INTERACTION_PASS ${checks}: ${name}`);};
 const program=await p.bountyProgram.create({data:{ownerId:owner.id,companyName:'Visual fixture '+('LongTargetIdentity'.repeat(5)),requiredUserAgent:'Visual-Fixture/1'}});
 const asset=await p.scopeAsset.create({data:{programId:program.id,originalValue:'app.visual.test',normalizedValue:'app.visual.test',format:'SUBDOMAIN',type:'WEB_APPLICATION',assetValue:'CRITICAL'}});
 const scope=await p.scope.create({data:{userId:owner.id,hostPattern:'app.visual.test',status:'APPROVED'}});
 const target=await p.target.create({data:{userId:owner.id,programId:program.id,scopeId:scope.id,scopeAssetId:asset.id,host:'app.visual.test'}});
 const scan=await p.scanRun.create({data:{targetId:target.id,scopeAssetId:asset.id,type:'RECON',status:'COMPLETED',outcome:'PARTIAL',artifactVersion:2,reconSteps:{create:{name:'HTTP surface',position:0,state:'PARTIAL',reason:'Fixture time budget exhausted'}}}});
 await p.scanLog.createMany({data:[{stream:'STDOUT',line:'Normal visual fixture output'},{stream:'STDERR',line:'Warning visual fixture output'}].map(row=>({...row,scanRunId:scan.id}))});
 const model='visual-model-'+('LongModelSegment'.repeat(30));
 await p.aiProviderConfig.upsert({where:{userId_provider:{userId:owner.id,provider:'OLLAMA'}},create:{userId:owner.id,provider:'OLLAMA',model,baseUrl:'http://127.0.0.1:1',isActive:true},update:{model,baseUrl:'http://127.0.0.1:1',isActive:true}});
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(v=>localStorage.setItem('theme',v),theme);
  await page.goto(`${origin}/scopes?target=${program.id}`);await page.getByRole('button',{name:'View scope.md',exact:true}).waitFor();
  const skip=page.getByRole('link',{name:'Skip to content',exact:true});await skip.focus();await page.keyboard.press('Enter');
  assert(page.url().endsWith('#main-content'));verify(`${theme}/${width}: skip link targets main`);
  assert(await page.locator('#main-content').evaluate(e=>e===document.activeElement));
  const nav=page.getByRole('navigation',{name:'Primary navigation',exact:true});
  assert.equal(await nav.locator('[aria-current="page"]').innerText(),'Scopes');assert.equal(await nav.getByRole('link',{name:/Findings|Reports/}).count(),0);verify(`${theme}/${width}: active Target, no global Findings/Report inventions`);
  const scroll=page.getByRole('region',{name:'Scope Assets table',exact:true});await scroll.focus();const before=await scroll.evaluate(e=>({left:e.scrollLeft,wide:e.scrollWidth>e.clientWidth}));
  if(before.wide){await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('[aria-label="Scope Assets table"]').scrollLeft>0);}
  assert.equal(before.wide,false);verify(`${theme}/${width}: data table keyboard scrolling`);
  await page.locator('tbody summary').filter({hasText:/^Actions$/}).first().click();
  const retire=page.getByRole('button',{name:'Retire asset app.visual.test',exact:true});await retire.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Retire Scope asset',exact:true});await dialog.waitFor();
  assert(await dialog.evaluate(e=>e.contains(document.activeElement)));assert.equal(await dialog.getByRole('button',{name:'Confirm retirement',exact:true}).getAttribute('data-variant'),'danger');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await retire.evaluate(e=>e===document.activeElement));
  verify(`${theme}/${width}: destructive confirmation/cancel/focus`);
  assert.equal((await p.scopeAsset.findUniqueOrThrow({where:{id:asset.id}})).active,true);
  await page.getByRole('link',{name:'Target settings',exact:true}).click();await page.getByRole('button',{name:'Save Target',exact:true}).waitFor();
  const name=page.getByLabel('Company / Program name *',{exact:true});await name.fill('');await page.getByRole('button',{name:'Save Target',exact:true}).click();
  assert(await name.evaluate(e=>!e.validity.valid&&e===document.activeElement));
  verify(`${theme}/${width}: native required-field errors remain keyboard accessible`);
  await page.goto(origin+'/settings');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await page.locator('summary').filter({hasText:/^Add or update a provider$/}).click();await page.getByLabel('Provider',{exact:true}).waitFor();
  const configured=page.getByRole('group',{name:'Configured OLLAMA provider',exact:true});await configured.waitFor();await configured.locator('summary').filter({hasText:/^Details$/}).click();assert((await configured.innerText()).includes(model));
  await page.screenshot({path:`/tmp/bh-m6/screenshots/settings-${theme}-${width}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const toggle=page.getByRole('button',{name:theme==='dark'?'Switch to light theme':'Switch to dark theme',exact:true});await toggle.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme==='dark'?'light':'dark');await page.keyboard.press('Enter');
  verify(`${theme}/${width}: keyboard theme toggle and long Settings model`);
  await page.goto(`${origin}/scopes/${asset.id}`);await page.getByText('Recon Console',{exact:true}).waitFor();
  const raw=page.locator('details').filter({has:page.locator('summary',{hasText:'Raw scan output'})});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('summary')).some(e=>e.textContent.includes('Raw scan output (2 received lines)')));
  assert.equal(await raw.getAttribute('open'),null);await raw.locator('summary').focus();await page.keyboard.press('Enter');
  const out=raw.locator('pre').filter({hasText:'Normal visual fixture output'}),err=raw.locator('pre').filter({hasText:'Warning visual fixture output'});await err.waitFor();
  assert((await out.innerText()).includes('[STDOUT]'));assert((await err.innerText()).includes('[STDERR]'));
  assert.equal(await out.evaluate(e=>getComputedStyle(e).color),await err.evaluate(e=>getComputedStyle(e).color));
  assert((await page.locator('body').innerText()).includes('Fixture time budget exhausted'));
  if(width===390)await page.screenshot({path:`/tmp/bh-m6/screenshots/scope-logs-${theme}-${width}.png`});
  verify(`${theme}/${width}: secondary bounded SSE output, neutral streams and labelled partial stage`);
 }
 console.log(`M6_INTERACTION_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}

export async function auditScopeUrlState({prisma:p,owner,origin,page}){
 const program=await p.bountyProgram.create({data:{ownerId:owner.id,companyName:'Scope URL consistency fixture',requiredUserAgent:'Visual-Fixture/1'}});
 const rows=Array.from({length:26},(_,i)=>({programId:program.id,originalValue:`asset${String(i).padStart(2,'0')}.url.test`,normalizedValue:`asset${String(i).padStart(2,'0')}.url.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION'}));
 await p.scopeAsset.createMany({data:rows});
 const pager=page.getByRole('navigation',{name:'Scope management pages',exact:true});
 let release,markNavigation;const delayed=new Promise(resolve=>{release=resolve;}),navigation=new Promise(resolve=>{markNavigation=resolve;}),pending=new Set();const pattern=`**/scopes?target=${program.id}&**`;
 const handler=route=>{const work=(async()=>{const request=route.request(),url=new URL(request.url());if(request.headers()['rsc']==='1'&&url.searchParams.get('assetPage')==='1'){markNavigation();await delayed;}await route.continue();})();pending.add(work);return work.finally(()=>pending.delete(work));};
 await page.route(pattern,handler);
 try{
  let releaseAssets;const initialAssets=new Promise(resolve=>{releaseAssets=resolve;});const assetPattern=`**/api/programs/${program.id}/assets?**`,assetPending=new Set();
  const holdAssets=route=>{const work=(async()=>{await initialAssets;await route.continue();})();assetPending.add(work);return work.finally(()=>assetPending.delete(work));};
  await page.route(assetPattern,holdAssets);
  try{
   const requested=page.waitForRequest(r=>new URL(r.url()).pathname===`/api/programs/${program.id}/assets`);
   requested.catch(()=>{});await page.goto(`${origin}/scopes?target=${program.id}&assetPage=2&pageSize=25`);await requested;
   assert(await page.getByRole('status').filter({hasText:'Loading Scope Assets…'}).isVisible(),'initial Scope request must show loading');
   assert.equal(await page.getByText('Add an explicitly authorized Scope Asset to begin.',{exact:true}).count(),0,'pending data is not an empty collection');
  }finally{releaseAssets();await Promise.allSettled([...assetPending]);await page.unroute(assetPattern,holdAssets);}
  await pager.getByRole('status').filter({hasText:'Page 2 of 2 · 26'}).waitFor();
  const clamped=page.waitForResponse(async response=>{if(new URL(response.url()).pathname!==`/api/programs/${program.id}/assets`||!response.ok())return false;const body=await response.json();return body.page===1&&body.total===25;});
  clamped.catch(()=>{});await page.locator('tbody summary').filter({hasText:/^Actions$/}).first().click();await page.getByRole('button',{name:'Retire asset '+rows[25].normalizedValue,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm retirement',exact:true}).click();await clamped;let timeout;try{await Promise.race([navigation,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Canonical navigation was not requested within 30 seconds')),30000);})]);}finally{clearTimeout(timeout);}
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(new URL(page.url()).searchParams.get('assetPage'),'2','URL is held before canonical navigation commits');
  assert((await pager.innerText()).includes('Page 2 of 2'),'do not publish a clamped counter while the old URL is still current');
  release();await pager.getByRole('status').filter({hasText:'Page 1 of 1 · 25'}).waitFor();assert.equal(new URL(page.url()).searchParams.get('assetPage'),'1');
 }finally{release();await Promise.allSettled([...pending]);await page.unroute(pattern,handler);}
 console.log('M6_URL_STATE_BROWSER: 2 passed, 0 failed, 0 skipped (delayed RSC, retirement, canonical counter/URL)');
}
