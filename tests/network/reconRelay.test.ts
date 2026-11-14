import { allowFixture } from '../helpers/egressLab';
import { afterAll,beforeAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { createServer,type Server } from 'node:http';
import { once } from 'node:events';
import { createReconRelay } from '@/server/recon/transport';
import { ReconProtection } from '@/server/recon/protection';
import { withTargetExecution,type TargetExecution } from '@/server/execution';
const mocks=vi.hoisted(()=>({asset:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{scopeAsset:{findUnique:mocks.asset}}}));
const suite=process.env.SCANNER_HTTP_TESTS==='1'?describe:describe.skip;
suite('real HTTP Recon relay guards (authorization DB fixture only; no CLI simulation)',()=>{
  let server:Server,base:string,execution:TargetExecution,active:boolean;const seen:{url:string;ua:string}[]=[];
  beforeAll(async()=>{server=createServer((req,res)=>{seen.push({url:req.url!,ua:String(req.headers['user-agent'])});res.setHeader('Set-Cookie','session=PRIVATE');if(req.url==='/app/redirect')return res.writeHead(302,{Location:'http://outside.test/'}).end();if(req.url==='/app/rate')return res.writeHead(429).end();res.end('local fixture');});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+(server.address() as {port:number}).port;allowFixture(server);});
  beforeEach(()=>{seen.length=0;active=true;const asset={id:'asset',programId:'program',originalValue:base+'/app/',normalizedValue:base+'/app/',format:'URL',active:true,type:'API',assetValue:'MEDIUM'};execution={targetId:'target',host:new URL(base).host,scopeAsset:asset,requiredUserAgent:'Relay-Test/1',qualifying:[],nonQualifying:[]};mocks.asset.mockImplementation(async()=>({...asset,active,program:{outOfScope:[],deletingAt:null},executionTarget:{scope:{status:'APPROVED'}}}));});
  afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const relay=()=>withTargetExecution(execution,()=>createReconRelay(execution,base+'/app/',new ReconProtection(1000,20),new AbortController().signal,async()=>{},{remaining:20}));
  it('forwards authorized reads with the program User-Agent, observes redirects without following, strips cookies',async()=>{const r=await relay();try{const result=await fetch(r.toRelay(base+'/app/redirect'),{redirect:'manual'});expect(result.status).toBe(302);expect(result.headers.has('set-cookie')).toBe(false);expect(seen).toEqual([{url:'/app/redirect',ua:'Relay-Test/1'}]);}finally{await r.close();}});
  it('denies wrong paths, absolute foreign references, traversal, unsafe actions and write methods before outgoing traffic',async()=>{const r=await relay();try{for(const path of ['/outside','/app/%252e%252e/outside','/app/delete'])expect((await fetch(r.origin+path)).status).toBeGreaterThanOrEqual(400);expect(()=>r.mapUrl('http://outside.test/app/')).toThrow();expect((await fetch(r.origin+'/app/',{method:'POST'})).status).toBe(403);expect(seen).toHaveLength(0);}finally{await r.close();}});
  it('stops after HTTP 429 and never reports blocked as absence',async()=>{const r=await relay();try{expect((await fetch(r.origin+'/app/rate')).status).toBe(429);expect((await fetch(r.origin+'/app/next')).status).toBe(429);expect(seen).toHaveLength(1);}finally{await r.close();}});
  it('does not confirm cleanup while a structured response write remains in flight',async()=>{
    let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
    const r=await withTargetExecution(execution,()=>createReconRelay(execution,base+'/app/',new ReconProtection(1000,20),new AbortController().signal,async()=>{entered();await waiting;},{remaining:20}));
    const request=fetch(r.origin+'/app/one').catch(()=>null);await started;let closed=false;const closing=r.close().then(()=>{closed=true;});await new Promise(r=>setTimeout(r,20));expect(closed).toBe(false);release();await closing;await request;
  });
  it('checks live revocation again before every request',async()=>{const r=await relay();try{expect((await fetch(r.origin+'/app/one')).status).toBe(200);active=false;expect((await fetch(r.origin+'/app/two')).status).toBeGreaterThanOrEqual(400);expect(seen).toHaveLength(1);}finally{await r.close();}});
  it('preserves HEAD instead of silently converting it into a GET request',async()=>{
    const methods:string[]=[];
    const r=await withTargetExecution(execution,()=>createReconRelay(execution,base+'/app/',new ReconProtection(1000,20),new AbortController().signal,async page=>{methods.push(page.method);},{remaining:20}));
    try{const response=await fetch(r.origin+'/app/one',{method:'HEAD'});expect(response.status).toBe(200);expect(await response.text()).toBe('');expect(methods).toEqual(['HEAD']);expect(seen).toHaveLength(1);}finally{await r.close();}
  });
});
