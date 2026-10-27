import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';
import {readFile,writeFile} from 'node:fs/promises';
const app=process.env.TEST_APP_URL??'http://localhost:3103';assert(app==='http://localhost:3103');
if(!process.env.E2E_EMAIL||!process.env.E2E_PASSWORD){console.error('E2E_AUTH_UNAVAILABLE: E2E_EMAIL and E2E_PASSWORD are required.');process.exit(2)}
const {hostId,programId}=JSON.parse(await readFile('/tmp/deep-audit-objects.json','utf8'));
const b=await chromium.launch({headless:true,args:['--no-sandbox']});const p=await b.newPage();const results=[];
try{
await p.goto(`${app}/login`);await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.type),'email');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.type),'password');await p.keyboard.press('Escape');results.push({scenario:'login keyboard order and masked password',result:'PASS'});
await p.getByLabel('Email',{exact:true}).fill(process.env.E2E_EMAIL);await p.getByLabel('Password',{exact:true}).fill(process.env.E2E_PASSWORD);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL(`${app}/targets`);
for(const route of [`/targets/${hostId}/findings`,`/targets/${hostId}/report`,'/settings','/recon',`/research?program=${programId}`]){
 await p.goto(app+route);await p.getByRole('navigation').waitFor();await p.waitForTimeout(150);
 const missing=await p.evaluate(()=>[...document.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(e=>e.offsetParent!==null).filter(e=>!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&![...(e.labels??[])].some(l=>l.textContent.trim())).length);
 results.push({scenario:`labelled form controls ${route.replaceAll(hostId,'HOST').replaceAll(programId,'PROGRAM')}`,result:missing?'FAIL':'PASS',missing});console.log(`${missing?'FAIL':'PASS'}: accessible control labels (${missing} missing)`);
}
}catch(e){results.push({scenario:`accessibility scenario (${e.name}; details suppressed)`,result:'FAIL'});process.exitCode=1}
finally{await writeFile('/tmp/deep-accessibility-results.json',JSON.stringify(results,null,2));await b.close()}
if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
