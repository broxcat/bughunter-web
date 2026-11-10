import {inspectVisualSurface} from './milestone6VisualAcceptance.mjs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// Practical DOM/keyboard checks. Visiting a page must never perform target requests.
export async function auditAccessibility({prisma,owner,origin,page,program,asset,target,parent}){
 const session=await prisma.researchSession.create({data:{userId:owner.id,targetId:target.id,workspaceId:randomUUID(),status:'ARCHIVED',targetHost:target.host,programName:program.companyName,scopeMarkdown:'# Historical fixture'}});
 const hypothesis=await prisma.researchHypothesis.create({data:{sessionId:session.id,externalId:'H-1',title:'Accessibility fixture',status:'OPEN',hypothesis:'Synthetic hypothesis',evidenceFor:[],evidenceAgainst:[],nextTest:'Manual review',expectedSignal:'Unknown',falsificationCondition:'Unknown',contentSha256:'a'.repeat(64)}});
 const hunt=await prisma.scanRun.create({data:{targetId:target.id,type:'HUNT',status:'COMPLETED'}});
 // Populated Findings/Reports complement the empty-state and lifecycle workflow suites.
 const candidate=await prisma.finding.create({data:{targetId:target.id,title:'Visual candidate fixture',severity:'HIGH',description:'Synthetic local visual evidence'}});
 const confirmed=await prisma.finding.create({data:{targetId:target.id,title:'Visual confirmed fixture',severity:'MEDIUM',reviewStatus:'CONFIRMED',lifecycle:null}});
 const report=await prisma.report.create({data:{userId:owner.id,targetId:target.id,title:'Visual saved report',markdown:'# Historical visual report\n\nSynthetic local fixture; no production evidence.'}});
 await prisma.reportItem.create({data:{reportId:report.id,findingId:confirmed.id}});
 const pages=[['/hosts/[id]','/hosts/'+target.id],['/hunt/[id]','/hunt/'+hunt.id],['/hunt','/hunt'],['/recon','/recon'],['/recon/runs/[id]','/recon/runs/'+parent.id],['/research/history/[id]/hypotheses/[hypothesisId]',`/research/history/${session.id}/hypotheses/${hypothesis.id}`],['/research/history/[id]','/research/history/'+session.id],['/research','/research?program='+program.id],['/scopes/[id]','/scopes/'+asset.id],['/scopes','/scopes?target='+program.id],['/settings','/settings'],['/targets/[id]/findings','/targets/'+program.id+'/findings'],['/targets/[id]','/targets/'+program.id],['/targets/[id]/report','/targets/'+program.id+'/report'],['/targets/[id]/settings','/targets/'+program.id+'/settings'],['/targets','/targets'],['/research/[id]/hypotheses/[hypothesisId]',`/research/${session.id}/hypotheses/${hypothesis.id}`],['/login','/login'],['/','/'],['/register','/register']];
 await mkdir('/tmp/bh-m6/screenshots',{recursive:true});let checks=0,visualChecks=0;const failures=[];
 for(const theme of ['light','dark'])for(const width of [1280,390])for(const [pattern,path] of pages.filter(([pattern])=>!process.env.POST_V1_A11Y_PATH||pattern===process.env.POST_V1_A11Y_PATH)){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('theme',t),theme);
  const response=await page.goto(origin+path);assert(response.status()<400,`${pattern}: document ${response.status()}`);
  // Include asynchronously loaded populated Target controls, not just its SSR shell.
  if(pattern==='/targets/[id]')await page.getByRole('navigation',{name:'Target workflow',exact:true}).waitFor();
  if(pattern==='/targets/[id]/findings')await page.getByText(candidate.title,{exact:true}).first().waitFor();
  if(pattern==='/targets/[id]/report'){const saved=page.getByRole('combobox',{name:'Saved report',exact:true});await saved.waitFor();assert(await saved.evaluate((e,id)=>Array.from(e.options).some(o=>o.value===id),report.id));}
  // Wait for hydrated client forms, without waiting on external services.
  await page.locator('h1, [role="alert"]').first().waitFor();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('p')).some(e=>e.getClientRects().length&&/^Loading.*[.…]$/.test(e.textContent.trim())));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const audit=await page.evaluate(()=>{
   const visible=e=>e.checkVisibility({visibilityProperty:true});
   const issues=[];
   for(const e of document.querySelectorAll('button button,button a[href],a[href] button'))issues.push('nested interactive '+e.outerHTML.slice(0,120));
   for(const e of document.querySelectorAll('input:not([type="hidden"]),textarea,select')){
    if(!visible(e))continue;
    const labelled=e.getAttribute('aria-label')?.trim()||e.getAttribute('aria-labelledby')?.split(/\s+/).some(id=>document.getElementById(id)?.textContent.trim())||Array.from(e.labels??[]).some(l=>l.textContent.trim());
    if(!labelled)issues.push('unlabelled '+e.tagName+' '+(e.name||e.placeholder||e.outerHTML.slice(0,80)));
   }
   for(const e of document.querySelectorAll('button,a[href],input,select,textarea,summary')){
    if(!visible(e)||e.disabled||e.closest('[inert]'))continue;
    if(e.tabIndex<0)issues.push('unreachable '+e.tagName+' '+e.textContent.trim().slice(0,45));
    if(e.tagName==='BUTTON'&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby'))issues.push('unnamed button');
   }
   if(document.documentElement.scrollWidth>innerWidth)issues.push('document overflow '+document.documentElement.scrollWidth+'/'+innerWidth);
   for(const table of document.querySelectorAll('table'))if(visible(table)&&table.scrollWidth>innerWidth){let e=table.parentElement,scroll=false;while(e&&e!==document.body){if(['auto','scroll'].includes(getComputedStyle(e).overflowX))scroll=true;e=e.parentElement;}if(!scroll)issues.push('wide table without scroll container');}
   const rgba=value=>{const v=value.match(/^rgba?\(([^)]+)\)$/);return v?v[1].split(',').map(Number):null;};
   const blend=(a,b)=>{const alpha=a[3]??1;return a.slice(0,3).map((v,i)=>v*alpha+b[i]*(1-alpha));};
   const background=e=>{const layers=[];for(let n=e;n;n=n.parentElement){const c=rgba(getComputedStyle(n).backgroundColor);if(c)layers.unshift(c);}return layers.reduce((bg,c)=>blend(c,bg),[255,255,255]);};
   const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
   for(const e of document.querySelectorAll('body *')){
    if(!visible(e)||e.closest('script,style,svg,:disabled,[aria-disabled="true"]')||!Array.from(e.childNodes).some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))continue;
    const style=getComputedStyle(e),fg=rgba(style.color);if(!fg)continue;
    const bg=background(e),x=luminance(blend(fg,bg)),y=luminance(bg),ratio=(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
    const minimum=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700)?3:4.5;
    if(ratio+.01<minimum)issues.push('text contrast '+ratio.toFixed(2)+'/'+minimum+' '+e.tagName+' '+e.textContent.trim().slice(0,55)+' '+style.color+' '+JSON.stringify(bg));
   }
   return issues;
  });
  const visual=await page.evaluate(inspectVisualSurface);visualChecks++;
  if(visual.length)failures.push({pattern,theme,width,issues:visual});
  if(['/targets/[id]','/recon/runs/[id]'].includes(pattern))await page.screenshot({path:`/tmp/bh-m6/screenshots/${pattern.includes('recon')?'recon':'target'}-${theme}-${width}.png`});
  if(audit.length)failures.push({pattern,theme,width,issues:audit});
  // Traverse every currently visible native control by Tab. Include a second
  // cycle for browser chrome/autofocus; a trap leaves expected IDs unvisited.
  const expected=await page.evaluate(()=>Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')).filter(e=>e.checkVisibility({visibilityProperty:true})&&!e.matches(':disabled')&&e.tabIndex>=0&&!(e instanceof HTMLInputElement&&e.type==='radio'&&!e.checked)).map((e,n)=>{e.dataset.auditFocusId=String(n);return String(n);}));
  const unseen=new Set(expected);
  for(let n=0;n<expected.length*2+4&&unseen.size;n++){
    await page.keyboard.press('Tab');
    const focused=await page.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);return{id:e.dataset.auditFocusId,visible:parseFloat(s.outlineWidth)>0&&s.outlineStyle!=='none'||s.boxShadow!=='none'};});
    if(focused.id!==undefined){unseen.delete(focused.id);if(!focused.visible)failures.push({pattern,theme,width,issues:['missing focus indicator '+focused.id]});}
  }
  if(pattern==='/hosts/[id]'){
    const radios=page.getByRole('radio');if(await radios.count()===3){
      const selected=await radios.evaluateAll(rows=>rows.findIndex(e=>e.checked));
      await radios.nth(selected).focus();
      for(let n=1;n<=3;n++){await page.keyboard.press('ArrowRight');assert(await radios.nth((selected+n)%3).isChecked(),'native authentication radio navigation');}
    }
  }
  if(unseen.size){const names=await page.evaluate(ids=>ids.map(id=>{const e=document.querySelector('[data-audit-focus-id="'+id+'"]');return e?.outerHTML.slice(0,150);}),[...unseen]);failures.push({pattern,theme,width,issues:['keyboard cannot reach '+JSON.stringify(names)]});}checks++;
 }
 if(failures.length)console.log('A11Y_FAILURES '+JSON.stringify(failures));
 assert.deepEqual(failures,[]);
 console.log(`M6_VISUAL_BROWSER: ${visualChecks} page/theme/viewport checks passed, 0 failed, 0 skipped`);
 console.log(`ACCESSIBILITY_BROWSER: ${checks} page/theme/viewport checks passed, 0 failed, 0 skipped`);
}
