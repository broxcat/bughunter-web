import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { PRODUCER_REDIS_OPTIONS } from '../queue/scanQueue';
/** Cross-worker semaphore with finite Redis calls; lost renewal stops children. */
export async function withReconToolLease<T>(tool:string,signal:AbortSignal,work:(leaseSignal:AbortSignal)=>Promise<T>):Promise<T> {
  const client=new Redis(process.env.REDIS_URL??'redis://localhost:6379',PRODUCER_REDIS_OPTIONS);client.on('error',()=>{});
  const key=`bughunter:recon:tool:${tool}`,token=randomUUID(),stop=new AbortController();let pending=Promise.resolve(),timer:ReturnType<typeof setInterval>|undefined,owned=false;
  try{
    await client.connect();
    while(!await client.set(key,token,'PX',10000,'NX')){signal.throwIfAborted();await new Promise(r=>setTimeout(r,100));}owned=true;
    timer=setInterval(()=>{pending=pending.then(async()=>{const ok=await client.eval('if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("pexpire",KEYS[1],10000) else return 0 end',1,key,token);if(ok!==1)stop.abort(new Error('Tool lease lost'));}).catch(()=>stop.abort(new Error('Tool lease unavailable')));},2000);
    signal.throwIfAborted();return await work(AbortSignal.any([signal,stop.signal]));
  }finally{clearInterval(timer);await pending;if(owned)await client.eval('if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end',1,key,token).catch(()=>{});client.disconnect();}
}
