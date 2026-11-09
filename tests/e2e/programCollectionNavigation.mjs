import assert from 'node:assert/strict';
export async function auditProgramCollections({prisma,owner,origin,context,page}) {
 const prefix=owner.id+'_page_',name='Pagination fixture',data=Array.from({length:51},(_,n)=>({id:prefix+String(n).padStart(3,'0'),ownerId:owner.id,companyName:name,requiredUserAgent:'Fixture/1'}));
 await prisma.bountyProgram.createMany({data});let checks=0;
 for(const path of ['/targets','/recon'])for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('theme',t),theme);
  const query='q='+encodeURIComponent(name)+'&pageSize=25';
  await page.goto(origin+path+'?'+query);await page.getByRole('status').filter({hasText:'Page 1 of 3'}).waitFor();
  for(const expected of [2,3]){await page.getByRole('link',{name:'Next page',exact:true}).click();await page.getByRole('status').filter({hasText:`Page ${expected} of 3`}).waitFor();assert.equal(new URL(page.url()).searchParams.get('q'),name);}
  await page.reload();await page.getByRole('status').filter({hasText:'Page 3 of 3'}).waitFor();
  await page.getByRole('link',{name:'Previous page',exact:true}).click();await page.getByRole('status').filter({hasText:'Page 2 of 3'}).waitFor();
  await page.goBack();await page.getByRole('status').filter({hasText:'Page 3 of 3'}).waitFor();await page.goForward();await page.getByRole('status').filter({hasText:'Page 2 of 3'}).waitFor();
  await page.getByLabel('Search targets',{exact:true}).fill('No matching pagination fixture');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('status').filter({hasText:'Page 1 of 1 · 0 results'}).waitFor();assert.equal(new URL(page.url()).searchParams.has('page'),false);
  for(const value of ['invalid','999']){await page.goto(origin+path+'?'+query+'&page='+value);await page.getByRole('status').filter({hasText:value==='invalid'?'Page 1 of 3':'Page 3 of 3'}).waitFor();}
  const deleted=await context.request.delete(origin+'/api/programs/'+prefix+'050');assert.equal(deleted.status(),200);await page.reload();await page.getByRole('status').filter({hasText:'Page 2 of 2 · 50 results'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await prisma.bountyProgram.create({data:data[50]});checks++;
 }
 // Real modal semantics with a paused, synthetic deletion response. No deletion
 // or console/provider stop is sent while exercising keyboard behavior.
 const id=prefix+'000',pattern=origin+'/api/programs/'+id;
 let release;const gate=new Promise(r=>{release=r;});
 const intercept=async route=>{if(route.request().method()!=='DELETE')return route.continue();await gate;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic deletion blocked'})});};
 await context.route(pattern,intercept);
 try{
  await page.goto(origin+'/targets/'+id+'/settings');await page.locator('summary').filter({hasText:/^Delete target$/}).click();
  const opener=page.getByRole('button',{name:'Delete target',exact:true});await opener.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  for(let n=0;n<5;n++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.querySelector('dialog')?.matches(':modal')&&(document.activeElement===document.body||Boolean(document.activeElement.closest('dialog')))),'Tab must not activate background controls');}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await opener.evaluate(e=>e===document.activeElement),'focus returns to opener');
  await opener.click();await dialog.getByRole('button',{name:'Confirm deletion',exact:true}).click();await page.getByRole('button',{name:'Deleting…',exact:true}).waitFor();
  await page.keyboard.press('Escape');assert(await dialog.isVisible(),'in-flight deletion must retain its controlled modal state');
  release();await dialog.getByRole('alert').filter({hasText:'Synthetic deletion blocked'}).waitFor();
  await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Space');await dialog.waitFor({state:'detached'});checks++;
 }finally{release();await context.unroute(pattern,intercept);}
 const contrast=(a,b)=>{const lum=s=>{const rgb=s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 for(const theme of ['light','dark']){
  await page.evaluate(t=>localStorage.setItem('theme',t),theme);await page.goto(origin+'/targets');await page.getByRole('status').filter({hasText:/^Page /}).waitFor();await page.getByRole('button',{name:'Create target',exact:true}).click();
  const input=page.getByLabel('Name',{exact:true});await input.waitFor();
  const colors=await input.evaluate(e=>{const s=getComputedStyle(e);return{fg:s.color,bg:s.backgroundColor,border:s.borderTopColor,ring:s.outlineColor};});
  assert(contrast(colors.fg,colors.bg)>=4.5,theme+' input text contrast');
  assert(contrast(colors.border,colors.bg)>=3,theme+' control boundary contrast: '+JSON.stringify(colors));
  assert(contrast(colors.ring,colors.bg)>=3,theme+' focus ring contrast');
  const form=page.locator('form').filter({has:input}),submit=form.getByRole('button',{name:'Create target',exact:true});
  const buttonColors=await submit.evaluate(e=>{const s=getComputedStyle(e);return{fg:s.color,bg:s.backgroundColor};});assert(contrast(buttonColors.fg,buttonColors.bg)>=4.5,theme+' button text contrast');
  await submit.click();
  assert.equal(await form.evaluate(e=>e.checkValidity()),false);assert(await input.evaluate(e=>e.required&&Boolean(e.validationMessage)));checks++;
 }
 const retiring=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Retiring collection fixture',requiredUserAgent:'Fixture/1',deletingAt:new Date()}});
 await page.goto(origin+'/targets?q=Retiring+collection+fixture');await page.getByRole('status').filter({hasText:'Deletion pending'}).waitFor();await page.getByRole('link',{name:'Open '+retiring.companyName,exact:true}).click();await page.getByRole('status').filter({hasText:'Target deletion is in progress'}).waitFor();checks++;
 console.log(`PROGRAM_COLLECTION_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
