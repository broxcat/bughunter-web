// Opt-in real executable acceptance test in an exclusively disposable stack.
// Passive providers query example.com; active tools touch only the fixture.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../../src/lib/prisma';
import { ensureProgramContext } from '../../src/server/programContext';
import { createScanRequest } from '../../src/server/queue/scanRequest';
import { publishScanJob } from '../../src/server/queue/scanJobPublisher';
import { createScanProcessor } from '../../src/server/queue/processScan';
import { SCAN_QUEUE_NAME, type ScanJobData } from '../../src/server/queue/scanQueue';
import { ScanControl, withScanControl } from '../../src/server/scanControl';
import { loadTargetExecution, withTargetExecution } from '../../src/server/execution';
import { runCommand } from '../../src/server/scanners/runCommand';
import { deleteProgram } from '../../src/server/programDeletion';
import { persistProgramDiscovery } from '../../src/server/recon/program';
if(process.env.BH_DISPOSABLE_REAL_TOOLS!=='1'||new URL(process.env.DATABASE_URL!).pathname!=='/recon_test')throw new Error('Disposable real-tools stack required');
const exec=promisify(execFile),connection=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:null});connection.on('error',()=>{});
const processor=createScanProcessor('real-tools-acceptance');
const worker=new Worker<ScanJobData>(SCAN_QUEUE_NAME,(job,token,signal)=>processor.process(job,signal,token),{connection,concurrency:1});worker.on('error',()=>{});
try{
  for(const [cmd,args] of [['subfinder',['-version']],['nmap',['--version']],['httpx',['-version']],['katana',['-version']]] as const){const r=await exec(cmd,[...args],{timeout:10000});const lines=(r.stdout+r.stderr).replace(/\x1b\[[0-9;]*m/g,'').trim().split('\n');console.log(cmd+': '+lines.filter(line=>/version/i.test(line)).join(' '));}
  const user=await prisma.user.create({data:{email:randomUUID()+'@example.test'}});
  const program=await prisma.bountyProgram.create({data:{ownerId:user.id,companyName:'Real passive wildcard fixture',requiredUserAgent:'laziza',scopeRules:['*.example.com'],outOfScope:['admin.example.com','*.internal.example.com']}});
  const context=await ensureProgramContext(user.id,program.id);
  async function execute(targetId:string){
    const r=await createScanRequest(user.id,{targetId,type:'RECON'},null);assert.equal((await publishScanJob(r.id)).dispatch,'PUBLISHED');
    const deadline=Date.now()+200000;let last='';
    while(true){const current=await prisma.scanRun.findUniqueOrThrow({where:{id:r.id}});if(current.status!==last){console.log('RECON '+targetId+': '+current.status);last=current.status;}if(!['RUNNING','QUEUED'].includes(current.status))return current;if(Date.now()>deadline)throw new Error('Real Recon deadline exceeded');await new Promise(resolve=>setTimeout(resolve,200));}
  }
  const passive=await execute(context.id),passiveLogs=await prisma.scanLog.findMany({where:{scanRunId:passive.id},orderBy:{createdAt:'asc'}});
  assert(passiveLogs.some(l=>l.line.startsWith('$ subfinder -d example.com -silent -duc')));
  const subfinderStep=passiveLogs.find(l=>l.line.startsWith('[recon] subfinder:'))?.line;
  const realDiscoveries=await prisma.hostDiscovery.count({where:{scanRunId:passive.id,source:'SUBFINDER'}});
  assert(subfinderStep==='[recon] subfinder: completed'||(subfinderStep?.includes('timeout after')&&realDiscoveries>0)||realDiscoveries>=10000,JSON.stringify({subfinderStep,realDiscoveries}));
  assert(!passiveLogs.some(l=>/^\$ (nmap|httpx|katana) /.test(l.line)));
  assert.deepEqual((await prisma.bountyProgram.findUniqueOrThrow({where:{id:program.id}})).scopeRules,['*.example.com']);
  console.log('PASSIVE REAL RESULT '+JSON.stringify({outcome:passive.outcome,reason:passive.error,discovered:await prisma.hostDiscovery.count({where:{scanRunId:passive.id}}),hosts:await prisma.target.count({where:{programId:program.id,active:true}})}));
  const fixtureProgram=await prisma.bountyProgram.create({data:{ownerId:user.id,companyName:'Local active fixture',requiredUserAgent:'laziza',scopeRules:['fixture.recon.test']}});
  const scope=await prisma.scope.create({data:{userId:user.id,hostPattern:'fixture.recon.test',status:'APPROVED'}});
  const host=await prisma.target.create({data:{userId:user.id,programId:fixtureProgram.id,scopeId:scope.id,host:'fixture.recon.test',scheme:'http'}});
  const active=await execute(host.id),logs=(await prisma.scanLog.findMany({where:{scanRunId:active.id}})).map(l=>l.line);
  for(const tool of ['httpx','nmap','katana'])assert(logs.some(line=>line===`[recon] ${tool}: completed`),JSON.stringify({tool,logs}));
  const fixture=await (await fetch('http://fixture.recon.test/__observations',{headers:{'User-Agent':'laziza'}})).json();
  assert(fixture.length>1);assert(fixture.every((r:{ua:string})=>r.ua==='laziza'),JSON.stringify(fixture));
  console.log('ACTIVE LOCAL RESULT '+JSON.stringify({outcome:active.outcome,reason:active.error,tools:['httpx','nmap','katana'],httpRequests:fixture.length,allUserAgents:'laziza'}));
  // Interrupt the real installed enumerator, drain callbacks, then delete all
  // resources. A buffered result must never resurrect this program.
  const cancelling=await prisma.scanRun.create({data:{targetId:context.id,type:'RECON',status:'RUNNING'}});
  const control=new ScanControl({scanRunId:cancelling.id,attemptId:'real-tool-cancellation',workerId:'real-tools-acceptance'},async()=>{});
  const execution=await loadTargetExecution(context.id,'RECON');
  const timer=setTimeout(()=>control.abort('USER_CANCELLED'),500);
  const stopped=await withScanControl(control,()=>withTargetExecution({...execution,reconSeeds:['example.com']},()=>runCommand('subfinder',['-d','example.com'],{scanRunId:cancelling.id,timeoutMs:10000,onStdoutLine:async line=>{await persistProgramDiscovery(cancelling.id,line,'SUBFINDER');}})));
  clearTimeout(timer);assert(stopped.cancelled);assert(await control.cleanup());
  await prisma.scanRun.update({where:{id:cancelling.id},data:{status:'CANCELLED',cancelRequestedAt:new Date()}});
  await deleteProgram(user.id,program.id);await assert.rejects(persistProgramDiscovery(cancelling.id,'late.example.com','SUBFINDER'));
  assert.equal(await prisma.target.count({where:{programId:program.id}}),0);
  console.log('REAL SUBFINDER CANCELLATION + TARGET DELETION VERIFIED');
}finally{processor.stopAccepting();await processor.shutdown();await worker.close(true);connection.disconnect();await prisma.$disconnect();}
process.exit(0);
