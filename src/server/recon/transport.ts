import { createServer } from 'node:http';
import { withTargetExecution, type TargetExecution } from '../execution';
import { currentScanControl, withScanControl } from '../scanControl';
import { probe, type ProbeResult } from '../scanners/http';
import { assetAllowsUrl } from '@/lib/scopeAssets';
import { isSafeReadUrl } from '@/lib/observationSafety';
import { ReconProtection } from './protection';

/** Native HTTP scanners only talk to this per-run loopback relay. The existing
 * guarded client owns every remote request, scope check, budget and backoff.
 * CONNECT, arbitrary destinations, redirects and target-supplied commands are
 * never forwarded. The worker still runs the actual installed scanner binary. */
export async function createReconRelay(execution:TargetExecution,targetUrl:string,protection:ReconProtection,signal:AbortSignal,onResponse:(page:ProbeResult)=>Promise<void>,budget:{remaining:number},options:{requestHeaders?:(url:string,method:string)=>Promise<Record<string,string>>}={}) {
  const target=new URL(targetUrl),control=currentScanControl(),pending=new Set<Promise<unknown>>();let origin='';
  if(options.requestHeaders)execution={...execution,authenticatedOrigin:target.origin,authenticatedRequestHeaders:options.requestHeaders};
  const mapUrl=(raw:string)=>{const u=new URL(raw,origin);if(u.origin!==origin)throw new Error('Foreign relay origin');const result=new URL(u.pathname+u.search,target.origin).toString();if(!assetAllowsUrl(execution.scopeAsset!,result)||!isSafeReadUrl(result))throw new Error('Relay scope denied');return result;};
  const request=async(url:string,method:'GET'|'HEAD'='GET')=>withTargetExecution(execution,async()=>{
    if(!assetAllowsUrl(execution.scopeAsset!,url)||!isSafeReadUrl(url)||options.requestHeaders&&new URL(url).origin!==target.origin)throw new Error('Scope denied');
    signal.throwIfAborted();if(budget.remaining--<=0){protection.blocked=true;protection.reason='Asset request budget exhausted';protection.reasonCode='RESOURCE_LIMIT';throw new Error('PARTIAL: Asset request budget exhausted');}
    await protection.beforeRequest(signal);const page=await probe(url,{method,timeoutMs:8000,signal});protection.observe(page.error?undefined:page.status,page.error);await onResponse(page);return page;
  });
  const server=createServer((req,res)=>{const work=async()=>{
    try {
      if(!['GET','HEAD'].includes(req.method??'')||req.headers.host!==new URL(origin).host||!req.url?.startsWith('/')||req.url.startsWith('//')){res.writeHead(403).end();return;}
      const page=await request(mapUrl(origin+req.url),req.method as 'GET'|'HEAD');
      if(page.error){res.writeHead(502).end();return;}
      for(const name of ['content-type','server','location','www-authenticate','x-powered-by','retry-after'])if(page.headers[name])res.setHeader(name,page.headers[name]);
      res.statusCode=page.status;res.end(req.method==='HEAD'?'':page.body);
    }catch{res.writeHead(protection.blocked?429:503).end();}
  };const requestWork=(control?withScanControl(control,work):work()).catch(()=>{res.destroy();});pending.add(requestWork);void requestWork.finally(()=>pending.delete(requestWork));});
  server.on('connect',(_req,socket)=>socket.destroy());
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Relay unavailable');origin=`http://127.0.0.1:${address.port}`;
  const close=async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.allSettled([...pending]);};
  const release=control?.track(close);
  return{origin,mapUrl,toRelay:(url:string)=>{if(!assetAllowsUrl(execution.scopeAsset!,url))throw new Error('Scope denied');const u=new URL(url);if(u.origin!==target.origin)throw new Error('Unselected service');return origin+u.pathname+u.search;},request,async close(){await close();release?.();}};
}
