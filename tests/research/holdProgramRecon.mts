// Real queue/worker lifecycle, with an inert local subprocess instead of any
// network scanner. Used only in the disposable console acceptance stack.
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { spawn } from 'node:child_process';
import { prisma } from '../../src/lib/prisma';
import { createScanProcessor } from '../../src/server/queue/processScan';
import { currentScanControl } from '../../src/server/scanControl';
import { SCAN_QUEUE_NAME, type ScanJobData } from '../../src/server/queue/scanQueue';
if(process.env.BH_DISPOSABLE_CONSOLE !== '1') throw new Error('Disposable console test only');
const runId=process.env.BH_TEST_RUN_ID!;
const run=await prisma.scanRun.findUniqueOrThrow({where:{id:runId},include:{target:{include:{program:true}}}});
if(!run.target.contextOnly||run.target.program?.companyName!=='Global empty program')throw new Error('Controlled fixture required');
const processor=createScanProcessor('controlled-console-worker',async(_type,_host,id)=>{
  if(id!==runId)throw new Error('Unexpected test job');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  const control=currentScanControl()!;
  control.track(async force=>{child.kill(force?'SIGKILL':'SIGTERM');await exited;});
  console.log('CONTROLLED_RECON_RUNNING');
  await new Promise<void>((_,reject)=>control.signal.addEventListener('abort',()=>reject(control.signal.reason),{once:true}));
  return {outcome:'SUCCESS'};
});
const connection=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:null});connection.on('error',()=>{});
const worker=new Worker<ScanJobData>(SCAN_QUEUE_NAME,(job,token,signal)=>processor.process(job,signal,token),{connection,concurrency:1});
worker.on('error',()=>{});
worker.on('completed',()=>{console.log('CONTROLLED_RECON_STOPPED');void stop();});
let closing=false;
async function stop(){if(closing)return;closing=true;processor.stopAccepting();await processor.shutdown();await worker.close(true);connection.disconnect();await prisma.$disconnect();process.exit(0);}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
