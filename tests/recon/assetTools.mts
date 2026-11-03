// Actual native tools, worker, queue and disposable PostgreSQL/Redis.
// Active requests only target the explicitly authorized Docker-local fixture.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { ResearchReconContext } from '@/lib/research/recon';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordArtifact } from '@/server/recon/artifacts';
import { createScopeAsset } from '@/server/scopeAssets';
import { startTargetRecon,reconcileTargetRecon } from '@/server/recon/targetRuns';
import { generateReconSnapshot } from '@/server/research/reconSnapshots';
import { createScanProcessor } from '@/server/queue/processScan';
import { SCAN_QUEUE_NAME,type ScanJobData } from '@/server/queue/scanQueue';
assert.equal(process.env.BH_DISPOSABLE_ASSET_TOOLS,'1');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/asset_test');
const connection=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:null}),processor=createScanProcessor('adaptive-native-fixture');connection.on('error',()=>{});
const worker=new Worker<ScanJobData>(SCAN_QUEUE_NAME,(job,token,signal)=>processor.process(job,signal,token),{connection,concurrency:2});worker.on('error',()=>{});
try{
  const owner=await prisma.user.create({data:{email:randomUUID()+'@example.test'}}),program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Native local playbooks',requiredUserAgent:'Adaptive-Real/1'}});
  const assets=await Promise.all([{value:'http://fixture.recon.test/api/',type:'API' as const},{value:'fixture.recon.test',type:'WEB_APPLICATION' as const},{value:'*.recon.test',type:'WILDCARD' as const}].map(input=>createScopeAsset(owner.id,program.id,{...input,assetValue:input.type==='WILDCARD'?'LOW':'MEDIUM'})));
  await worker.pause(true);
  const parent=await startTargetRecon(owner.id,program.id),end=Date.now()+300000;
  const wildcard=assets.find(a=>a.type==='WILDCARD')!,wildcardScan=await prisma.scanRun.findFirstOrThrow({where:{targetReconRunId:parent.id,scopeAssetId:wildcard.id}});
  // Known-host fixture only. This does not pretend passive providers enumerated it.
  await recordArtifact(wildcardScan.id,wildcard,[],'hostname',{hostname:'fixture.recon.test'},{tool:'controlled-fixture',sourceRef:'fixture:known-local-host-not-passive-discovery',observedAt:new Date().toISOString()});await worker.resume();
  let scans:Prisma.ScanRunGetPayload<{include:{reconSteps:true;artifacts:true}}>[];
  for(;;){scans=await prisma.scanRun.findMany({where:{targetReconRunId:parent.id},include:{reconSteps:true,artifacts:true}});if(scans.every(s=>!['QUEUED','RUNNING'].includes(s.status)))break;if(Date.now()>end)throw new Error('Native fixture deadline exceeded: '+JSON.stringify(scans.map(s=>({status:s.status,error:s.error,steps:s.reconSteps}))));await new Promise(r=>setTimeout(r,200));}
  await reconcileTargetRecon(parent.id);
  for(const asset of assets){
    const scan=scans.find(s=>s.scopeAssetId===asset.id)!;assert(['SUCCESS','PARTIAL'].includes(scan.outcome!),JSON.stringify(scan));assert(scan.artifacts.length>5,'Normalized discoveries must include actual endpoint evidence');assert.equal(scan.artifactVersion,2);
    assert(!JSON.stringify(scan.artifacts).includes('PRIVATE_COOKIE')&&!JSON.stringify(scan.artifacts).includes('PRIVATE_BODY'));
    const steps=scan.reconSteps.map(s=>({name:s.name,status:s.state,reason:s.reason}));console.log(JSON.stringify({type:asset.type,scan:scan.id,outcome:scan.outcome,discoveries:scan.artifacts.length,steps}));
    const logs=await prisma.scanLog.findMany({where:{scanRunId:scan.id},select:{line:true}});for(const tool of ['httpx','ffuf','nuclei'])assert(logs.some(l=>l.line.startsWith('$ '+tool+' ')),tool+' must actually execute');
    if((scan.reconPlan as unknown as {gobuster?:{dir:boolean}})?.gobuster?.dir){assert(logs.some(l=>l.line.startsWith('$ gobuster dir ')),'Native Gobuster must execute');assert(scan.artifacts.some(a=>(a.sources as unknown as {tool:string}[]).some(s=>s.tool==='gobuster')),'Gobuster results must retain native provenance');}
    if(asset.format==='URL'){assert(scan.reconSteps.some(s=>s.name==='Ports / services'&&s.state==='SKIPPED'));assert(scan.artifacts.some(a=>a.kind==='endpoint'&&(a.value as {statusCode?:number}).statusCode===401));}
    else assert(logs.some(l=>l.line.startsWith('$ nmap ')),'Bounded native Nmap must execute');
    if(asset.type==='WILDCARD')for(const tool of ['subfinder','amass','assetfinder'])assert(logs.some(l=>l.line.startsWith('$ '+tool+' ')),'Actual offline passive source '+tool);
    assert(scan.artifacts.some(a=>a.scopeState==='OUT_OF_SCOPE'),'Absolute external references remain documentary');
    assert(scan.artifacts.some(a=>a.kind==='endpoint'&&(a.value as {url?:string}).url?.includes('/api/courses')));
    const brief=await prisma.scanRun.findUniqueOrThrow({where:{id:scan.id}});assert(brief.scopeMarkdown?.includes('format_version: 2')&&brief.scopeMarkdown.includes('Normalized discoveries: '+scan.artifacts.length));
    const snapshot=await generateReconSnapshot(owner.id,scan.targetId);assert(snapshot.snapshot!.context.counts.endpoints>=5);const full=(await prisma.researchReconSnapshot.findUniqueOrThrow({where:{id:snapshot.snapshot!.id}})).context as unknown as ResearchReconContext;assert(full.observations.some(o=>o.type==='dns-address'&&Array.isArray(o.facts?.addresses)));assert(snapshot.snapshot!.context.sources.some(s=>s.scanId===scan.id));assert.equal(await prisma.researchReconDelivery.count({where:{sessionId:snapshot.sessionId}}),0);
  }
  const target=await prisma.targetReconRun.findUniqueOrThrow({where:{id:parent.id}});assert(target.scopeMarkdown?.includes('Bug Bounty Target Intelligence'));
  const seen=await(await fetch('http://fixture.recon.test/__observations')).json() as {url:string;ua:string}[];assert(seen.length>10);assert(seen.every(r=>r.ua==='Adaptive-Real/1'));assert(!seen.some(r=>r.url.startsWith('/outside')||r.url.includes('/delete')||r.url.includes('logout')));
  console.log('NATIVE_ADAPTIVE_RECON_PASSED: actual HTTPX/FFUF/Nuclei/Nmap, target batch, artifacts, counts, both briefs, Research snapshot, scope/User-Agent guards; wildcard native orchestration uses one explicitly seeded local host and offline passive engines; no public enumeration/model invocation. '+seen.length+' local HTTP requests. Burp unavailable is explicitly Partial.');
}finally{processor.stopAccepting();await processor.shutdown();await worker.close(true);connection.disconnect();await prisma.$disconnect();}
process.exit(0);
