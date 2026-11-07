// Extend the existing disposable post-v1 fixture; no second server or scanner.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export async function auditNegativeStates({browser,origin,ownerContext,otherContext,page}) {
  const inventory=await readFile('docs/post-v1-route-inventory.md','utf8');
  const sections=inventory.split('## API handlers');
  const paths=text=>[...text.matchAll(/^\| `([^`]+)`/gm)].map(m=>m[1]);
  const pages=paths(sections[0]),apis=paths(sections[1]);
  assert.equal(pages.length,21);assert.equal(apis.length,67);
  const missing=path=>path.replace(/\[[^\]]+\]/g,'missing0000000000000000000');
  const anonymous=await browser.newContext();let checks=0;
  try {
    for(const path of apis.filter(p=>!/^\/api\/(auth(?:\/|$)|health$|register$)/.test(p))) {
      const response=path==='/api/internal/recon-observations'
        ?await anonymous.request.post(origin+path,{data:{},maxRedirects:0})
        :await anonymous.request.get(origin+missing(path),{maxRedirects:0});
      assert.equal(response.status(),401,path);assert.equal(response.headers().location,undefined,path);
      assert(response.headers()['content-type']?.includes('application/json'),path);checks++;
    }
    for(const path of pages.filter(p=>!['/','/login','/register'].includes(p))) {
      const response=await anonymous.request.get(origin+missing(path)+'?audit=bookmark',{maxRedirects:0});
      assert([303,307,308].includes(response.status()),path);
      const location=new URL(response.headers().location,origin);
      assert.equal(location.pathname,'/login',path);assert.equal(location.searchParams.get('callbackUrl'),missing(path)+'?audit=bookmark',path);checks++;
    }
    for(const line of sections[1].split('\n').filter(l=>l.startsWith('| `/api/')&&l.includes('GET')&&l.includes('[')&&!l.includes('/api/auth/'))) {
      const path=line.match(/`([^`]+)`/)[1];
      const response=await ownerContext.request.get(origin+missing(path),{maxRedirects:0});
      assert([400,403,404,409,410].includes(response.status()),`${path}: unexpected missing-resource status ${response.status()}`);checks++;
    }
    const empty=await otherContext.request.get(origin+'/api/programs');assert.equal(empty.status(),200);assert.deepEqual(await empty.json(),[]);checks++;
    for(const theme of ['light','dark']) for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900});await page.evaluate(value=>localStorage.setItem('theme',value),theme);
      await page.goto(origin+'/targets?audit=bookmark');await page.getByRole('heading',{name:'Targets',exact:true}).waitFor();
      await page.keyboard.press('Tab');
      assert(await page.evaluate(()=>{const e=document.activeElement;return e!==document.body&&parseFloat(getComputedStyle(e).outlineWidth)>0;}),'visible keyboard focus');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'responsive Targets');
      await page.reload();assert(new URL(page.url()).searchParams.has('audit'));
      await page.goto(origin+'/scopes');await page.goBack();assert(new URL(page.url()).searchParams.has('audit'));await page.goForward();assert.equal(new URL(page.url()).pathname,'/scopes');checks++;
    }
    console.log(`M1_NEGATIVE_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
  }finally{await anonymous.close();}
}
