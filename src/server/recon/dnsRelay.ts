import { createSocket } from 'node:dgram';
import { getServers } from 'node:dns';
import { isIP } from 'node:net';
import { currentScanControl,beforeScanNetwork } from '../scanControl';
import { acquireExecution, currentTargetExecution } from '../execution';
import { assetHostAllowed } from '../scopeAssets';
import type { ReconPlan } from '@/lib/reconPlanner';
import { ReconProtection } from './protection';
/** Native Gobuster never receives a resolver with unrestricted scope. */
export function dnsQuestion(packet:Buffer){
  if(packet.length<17||packet.readUInt16BE(4)!==1)throw new Error('Invalid DNS question');
  let offset=12;const labels:string[]=[];
  while(packet[offset]){const size=packet[offset++];if(size>63||offset+size>=packet.length)throw new Error('Invalid DNS name');labels.push(packet.subarray(offset,offset+size).toString('ascii'));offset+=size;}
  if(offset+5>packet.length||![1,5,28].includes(packet.readUInt16BE(offset+1))||packet.readUInt16BE(offset+3)!==1)throw new Error('Unsupported DNS question');
  return labels.join('.').toLowerCase();
}
export async function createReconDnsRelay(plan:ReconPlan,signal:AbortSignal,live:()=>Promise<unknown>){
  const execution=currentTargetExecution();
  const lifetime=new AbortController();signal=AbortSignal.any([signal,lifetime.signal]);
  const pending=new Set<Promise<void>>();
  const server=createSocket('udp4'),clients=new Set<ReturnType<typeof createSocket>>();const protection=new ReconProtection(plan.limits.rps,Math.min(60,plan.limits.maxRequests));let closed=false;
  const upstream=getServers().find(s=>isIP(s));if(!upstream)throw new Error('No supported DNS resolver');
  server.on('message',(packet,remote)=>{const work=(async()=>{
    const reply=(data:Buffer)=>{if(!closed)server.send(data,remote.port,remote.address,()=>{});};
    try{
      const host=dnsQuestion(packet);
      if(!assetHostAllowed({...plan.boundary,active:true},host,plan.authorization.exclusions))throw new Error('DNS outside scope');
      await live();await protection.beforeRequest(signal);signal.throwIfAborted();await beforeScanNetwork();
      const releaseTraffic = await acquireExecution({ tool: 'gobuster-dns', dnsHost: host }, AbortSignal.any([signal, AbortSignal.timeout(5000)]), execution);
      try {
        await new Promise<void>(resolve => {
          const socket=createSocket(isIP(upstream)===6?'udp6':'udp4');clients.add(socket);
          const timer=setTimeout(()=>socket.close(),2500);
          socket.once('close',()=>{clearTimeout(timer);clients.delete(socket);resolve();});
          socket.once('error',()=>socket.close());
          socket.once('message',data=>{reply(data);socket.close();});socket.send(packet,53,upstream);
        });
      } finally { await releaseTraffic(); }
    }catch{const denied=Buffer.from(packet);if(denied.length>=4){denied[2]=0x81;denied[3]=0x83;reply(denied);}}
  })();pending.add(work);void work.finally(()=>pending.delete(work));});
  await new Promise<void>(resolve=>server.bind(0,'127.0.0.1',resolve));const address=server.address();
  const close=async()=>{if(closed)return;closed=true;lifetime.abort();for(const client of clients)try{client.close();}catch{}await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.allSettled([...pending]);release?.();signal.removeEventListener('abort',abort);};
  const abort=()=>{void close();};const release=currentScanControl()?.track(close);signal.addEventListener('abort',abort,{once:true});
  return{resolver:`127.0.0.1:${address.port}`,close};
}
