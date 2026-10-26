import assert from "node:assert/strict";
import { chromium } from "playwright-chromium";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const app=process.env.TEST_APP_URL??"http://localhost:3103";assert(/^http:\/\/(localhost|127\.0\.0\.1):3103$/.test(app));
if(!process.env.E2E_EMAIL||!process.env.E2E_PASSWORD){console.error("E2E_AUTH_UNAVAILABLE: E2E_EMAIL and E2E_PASSWORD are required.");process.exit(2)}
const {programId,company}=JSON.parse(await readFile('/tmp/deep-audit-objects.json','utf8'));assert(company.startsWith('E2E Deep Audit Target '));
const b=await chromium.launch({headless:true,args:['--no-sandbox']});const c=await b.newContext();const p=await c.newPage();let original;
try{
await p.goto(`${app}/login`);await p.getByLabel('Email',{exact:true}).fill(process.env.E2E_EMAIL);await p.getByLabel('Password',{exact:true}).fill(process.env.E2E_PASSWORD);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL(`${app}/targets`);
original=await(await c.request.get(`${app}/api/programs/${programId}`)).json();assert(original.companyName.startsWith('E2E Deep Audit Target '));
await c.request.patch(`${app}/api/programs/${programId}`,{data:{qualifying:['XSS','IDOR','JWT','OAUTH','XXE'],nonQualifying:[]}});
let hosts=await(await c.request.get(`${app}/api/programs/${programId}/hosts`)).json();let h=hosts.find(h=>h.host==='e2e-public-audit.test'&&h.active);
if(!h){const response=await c.request.post(`${app}/api/programs/${programId}/hosts`,{data:{host:'e2e-public-audit.test'}});assert.equal(response.status(),201);h=await response.json()}
const setup='const{PrismaClient}=require("@prisma/client");const p=new PrismaClient();(async()=>{const h=await p.target.findUnique({where:{id:process.argv[1]},include:{program:true}});if(!h||h.host!=="e2e-public-audit.test"||!h.program.companyName.startsWith("E2E Deep Audit Target "))throw Error("Not fixture");await p.target.update({where:{id:h.id},data:{scheme:"http"}});await p.$disconnect()})().catch(()=>process.exit(1))';execFileSync('docker',['compose','exec','-T','web','node','-e',setup,h.id],{stdio:'pipe'});
if(!process.env.AUDIT_READINESS_REUSE_RECON){const response=await c.request.post(`${app}/api/scan-runs`,{data:{targetId:h.id,type:'RECON'}});assert.equal(response.status(),201);const run=await response.json();let status;for(let i=0;i<240;i++){const runs=await(await c.request.get(`${app}/api/scan-runs?targetId=${h.id}`)).json();status=runs.find(r=>r.id===run.id)?.status;if(['COMPLETED','FAILED'].includes(status))break;await new Promise(r=>setTimeout(r,500))}assert.equal(status,'COMPLETED')}
const meta=await(await c.request.get(`${app}/api/targets/${h.id}/hunt-readiness`)).json();const states=Object.fromEntries(meta.families.map(f=>[f.family,f.state]));assert.equal(meta.credentials.length,0);console.log(JSON.stringify({publicHostReadiness:{xss:states.xss,bola:states.bola,jwt:states.jwt,oauth:states.oauth,xxe:states.xxe}}));
await p.goto(`${app}/targets/${programId}`);await p.getByLabel('Readiness host',{exact:true}).selectOption(h.id);await p.getByText('XSS: READY',{exact:true}).waitFor({timeout:4000});assert.equal(states.xss,'READY');assert.equal(states.bola,'BLOCKED');assert.equal(states.jwt,'BLOCKED');assert.equal(states.oauth,'NOT_APPLICABLE');assert.equal(states.xxe,'NOT_APPLICABLE');console.log('PASS: public XSS ready without credentials; BOLA/JWT blocked; absent OAuth/XML not applicable before Hunt');
await writeFile('/tmp/deep-readiness-result.json',JSON.stringify({passed:true,states}));
}finally{if(original)await c.request.patch(`${app}/api/programs/${programId}`,{data:{qualifying:original.qualifying,nonQualifying:original.nonQualifying}});await b.close()}
