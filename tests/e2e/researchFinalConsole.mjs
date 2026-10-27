// Actual configured LOCAL Compose DB + final images + real Tailscale origin.
// Only this script's synthetic .test account/Target/workspace are created/removed.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-chromium';
const exec=promisify(execFile),cmd=async(file,args)=>(await exec(file,args,{timeout:30000,maxBuffer:2**20})).stdout.trim();
const config=JSON.parse(await cmd('docker',['compose','config','--format','json']));
assert.equal(new URL(config.services.web.environment.DATABASE_URL).hostname,'db','Local Compose DB only');
const origin=new URL(config.services.web.environment.AUTH_URL).origin;
const secrets=Object.entries(config.services.web.environment).filter(([k,v])=>/AUTH_SECRET|DATABASE_URL|REDIS_URL|ENCRYPTION_KEY/.test(k)&&typeof v==='string'&&v.length>=12).map(([,v])=>v);
const safe=value=>{for(const s of secrets)assert(!value.includes(s),'Application secret appeared in console HTML');};
async function web(script){const p=spawn('docker',['compose','exec','-T','web','node','--import','tsx','--input-type=module'],{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.stdin.end(script);const code=await new Promise(r=>p.on('close',r));assert.equal(code,0,'Synthetic final console fixture operation failed');return JSON.parse(out);}
let data,browser;
try{
 assert.equal((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)})).status,200);
 // Avoid consuming an operator model account for automated synthetic research.
 const login=await exec('docker',['compose','exec','-T','-u','researcher','-e','HOME=/home/researcher','-e','CODEX_HOME=/home/researcher/.codex','research-console','codex','login','status'],{timeout:5000}).then(()=>true,()=>false);
 assert(!login,'Operator Codex account is signed in; run the isolated console suite instead of automatic remote inference.');
 data=await web(`import {PrismaClient} from '@prisma/client';import bcrypt from 'bcryptjs';import {randomUUID} from 'node:crypto';const p=new PrismaClient();const password=randomUUID();const user=await p.user.create({data:{email:'final-console-'+randomUUID()+'@example.test',passwordHash:await bcrypt.hash(password,10)}});const program=await p.bountyProgram.create({data:{ownerId:user.id,companyName:'Disposable final console smoke',requiredUserAgent:'FinalConsole/1'}});const scope=await p.scope.create({data:{userId:user.id,hostPattern:'console-final.example.test',status:'APPROVED'}});const target=await p.target.create({data:{userId:user.id,programId:program.id,scopeId:scope.id,host:'console-final.example.test'}});console.log(JSON.stringify({userId:user.id,email:user.email,password,targetId:target.id}));await p.$disconnect();`);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext(),page=await context.newPage();
 await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill(data.email);await page.getByLabel('Password',{exact:true}).fill(data.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(origin+'/targets');
 await page.goto(origin+'/research');await page.getByRole('link',{name:'Open console — console-final.example.test',exact:true}).click();await page.waitForURL(origin+`/research/${data.targetId}`);
 await page.locator('.xterm-screen').waitFor();await page.getByText('Terminal: connected',{exact:true}).waitFor({timeout:30000});
 assert.equal(await page.getByRole('navigation').count(),0);const html=await page.locator('body').innerText();safe(html);assert(!html.includes(data.email));assert.equal(await page.getByText('Download workspace ZIP',{exact:true}).count(),0);
 const pane=()=>cmd('docker',['compose','exec','-T','-u','researcher','research-console','tmux','list-panes','-t',`bughunter-${data.targetId}:0`,'-F','#{pane_pid}:#{pane_current_path}']);
 const first=await pane();assert(first.endsWith(`/workspaces/research_${data.targetId}`));await page.reload();await page.getByText('Terminal: connected',{exact:true}).waitFor();assert.equal(await pane(),first);
 await page.getByText('Codex: login required',{exact:true}).waitFor();await page.getByText('Burp MCP: unavailable',{exact:true}).waitFor({timeout:15000});
 const metadata=await web(`import {PrismaClient} from '@prisma/client';import {readFile} from 'node:fs/promises';const p=new PrismaClient();const s=await p.researchSession.findUniqueOrThrow({where:{consoleTargetId:${JSON.stringify(data.targetId)}}});const root='/research-target-workspaces/'+s.workspaceId;const scope=await readFile(root+'/scope.md','utf8'),policy=JSON.parse(await readFile(root+'/.agents/bughunter/policy.json','utf8'));console.log(JSON.stringify({scope,policy,findings:await p.finding.count({where:{targetId:s.targetId}}),reports:await p.report.count({where:{userId:s.userId}})}));await p.scope.update({where:{id:(await p.target.findUniqueOrThrow({where:{id:s.targetId}})).scopeId},data:{status:'REVOKED'}});await p.$disconnect();`);
 safe(JSON.stringify(metadata));assert(metadata.scope.includes('FinalConsole/1'));assert.equal(metadata.policy.requiredUserAgent,'FinalConsole/1');assert.equal(metadata.findings,0);assert.equal(metadata.reports,0);
 assert.equal(await page.evaluate(async id=>(await fetch(`/api/research-targets/${id}/terminal`,{method:'POST'})).status,data.targetId),400);
 console.log('FINAL PUBLIC CONSOLE PASSED: actual Tailscale HTTPS/WSS origin, Auth.js login, full-screen xterm, signed admission, native Codex/tmux CWD and refresh persistence, scoped policy/UA, explicit login-required/Burp-offline states, revoked scope refusal and no automatic Finding/Report.');
}finally{
 await browser?.close();
 if(data){
  assert(/^[a-z0-9]+$/i.test(data.targetId));
  await cmd('docker',['compose','exec','-T','-u','researcher','research-console','tmux','kill-session','-t',`=bughunter-${data.targetId}`]).catch(()=>{});
  await web(`import {PrismaClient} from '@prisma/client';import {rm} from 'node:fs/promises';const p=new PrismaClient();const u=await p.user.findUniqueOrThrow({where:{id:${JSON.stringify(data.userId)}}});if(!u.email.startsWith('final-console-')||!u.email.endsWith('@example.test'))throw new Error('Not our fixture');await p.researchSession.deleteMany({where:{userId:u.id}});await p.target.deleteMany({where:{userId:u.id}});await p.bountyProgram.deleteMany({where:{ownerId:u.id}});await p.user.delete({where:{id:u.id}});await rm('/research-target-workspaces/research_'+${JSON.stringify(data.targetId)},{recursive:true,force:true});console.log('{}');await p.$disconnect();`);
 }
}
