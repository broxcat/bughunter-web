import { allowFixture } from '../helpers/egressLab';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildReconPlan } from '@/lib/reconPlanner';
import type { AuthContextsSnapshot, CapturedAuthContext } from '@/lib/authenticatedRecon';
import { withTargetExecution, type TargetExecution } from '@/server/execution';
import { mapAuthenticatedSurfaces } from '@/server/recon/authenticatedMapping';
import { loadReconCredential, recordSurfaceObservation } from '@/server/authenticatedRecon';

vi.mock('@/server/recon/assetPipeline',()=>({assertLiveAsset:vi.fn(async()=>{})}));
vi.mock('@/server/authenticatedRecon',()=>({
  loadReconCredential:vi.fn(),
  recordSurfaceObservation:vi.fn(async()=>({id:'observation'})),
  surfaceResponseClass:(page:{status:number;error?:string;headers:Record<string,string>})=>page.error||!page.status?'UNAVAILABLE':[401,403,404,410].includes(page.status)?'DENIED':page.status>=300&&page.status<400&&/login/i.test(page.headers.location??'')?'LOGIN_REDIRECT':'CONTENT',
}));
let server:Server,origin:string,execution:TargetExecution;
const requests:{path:string;method:string;role:string}[]=[];
let sessionLost=false,rateLimited=false,rotate=false,expireAfterValidation=false;
const context=(key:string):CapturedAuthContext=>({credentialId:key,contextKey:key,label:key,purpose:'GENERAL',persona:null,sessionIdentityHash:key,sessionCheckId:key,sessionStatus:'VALID',checkedAt:'2026-11-04T10:00:00.000Z',expiresAt:null,validationUrl:origin+'/app/session',ownedObjectUrl:origin+'/app/users/[id]?record=',eligibility:'PLANNED'});
const snapshot=(contexts:CapturedAuthContext[]):AuthContextsSnapshot=>({version:1,anonymous:{contextKey:'ANONYMOUS',mode:'ANONYMOUS'},contextLimit:4,contexts});
function run(contexts:CapturedAuthContext[],overrides:Partial<Parameters<typeof mapAuthenticatedSurfaces>[0]>={}){
  const plan=buildReconPlan({id:'asset',normalizedValue:origin+'/app/',format:'URL',type:'WEB_APPLICATION',assetValue:'MEDIUM',active:true},{active:true,exclusions:[]},{authenticatedContexts:contexts.length});
  plan.limits.rps=10000;
  plan.authenticatedMapping={...plan.authenticatedMapping!,maxRequests:100,maxPagesPerContext:16,maxDurationMs:5000};
  return withTargetExecution(execution,()=>mapAuthenticatedSurfaces({scanRunId:'run',scopeAssetId:'asset',snapshot:snapshot(contexts),plan,signal:new AbortController().signal,seeds:[origin+'/app/'],budget:{remaining:100},browser:false,...overrides}));
}
beforeEach(async()=>{
  vi.clearAllMocks();requests.length=0;sessionLost=false;rateLimited=false;rotate=false;expireAfterValidation=false;
  server=createServer((req,res)=>{
    const role=req.headers.cookie?.includes('manager')?'manager':req.headers.cookie?.includes('user')?'user':'anonymous';
    const path=req.url??'/';requests.push({path,method:req.method??'',role});
    res.setHeader('Content-Type','text/html');
    if(rateLimited&&path==='/app/session'){res.writeHead(429).end('Rate limit');return;}
    if(path==='/app/session'){const status=role==='anonymous'||sessionLost?401:200;res.writeHead(status).end('session');if(expireAfterValidation&&role!=='anonymous'&&status===200)sessionLost=true;return;}
    if(sessionLost&&role!=='anonymous'){res.writeHead(307,{Location:'/app/login?callbackUrl='+encodeURIComponent(path)}).end();return;}
    if(path==='/app/admin'){res.writeHead(role==='manager'?200:403).end('role dependent');return;}
    if(path==='/app/dashboard'){res.writeHead(role==='anonymous'?401:200).end('<form action="/app/preferences" method="POST"><input name="displayName" value="PRIVATE_PII"></form>');return;}
    if(path==='/app/'){res.end('<a href="/app/public">public</a><a href="/app/dashboard">dashboard</a><a href="/app/admin">admin</a><a href="/app/logout">logout</a><a href="/outside">outside</a><a href="http://foreign.test/app/">foreign</a>');return;}
    if(path==='/app/public'||path.startsWith('/app/users/')){res.end('observed');return;}
    res.writeHead(404).end('Missing');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  allowFixture(server);
  execution={targetId:'target',host:new URL(origin).host,requiredUserAgent:'Auth-Mapper-Test/1',qualifying:[],nonQualifying:[],scopeAsset:{id:'asset',programId:'program',normalizedValue:origin+'/app/',originalValue:origin+'/app/',format:'URL',active:true,type:'WEB_APPLICATION',assetValue:'MEDIUM'}};
  let calls=0;
  vi.mocked(loadReconCredential).mockImplementation(async(_target,captured)=>{
    if(rotate&&++calls>1)return null;
    return{id:captured.credentialId,label:captured.label,cookies:{session:captured.contextKey==='AUTH_MANAGER'?'manager':'user'},validationUrl:origin+'/app/session',ownedObjectUrl:origin+'/app/users/48291?record=private-value'};
  });
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});

describe('bounded authenticated mapping with real local native HTTP',()=>{
  it('maps separate anonymous/user/manager contexts, retains role denial, and never performs actions or outside requests',async()=>{
    const emit=vi.fn<NonNullable<Parameters<typeof mapAuthenticatedSurfaces>[0]['onArtifact']>>(async()=>{}),result=await run([context('AUTH_USER'),context('AUTH_MANAGER')],{onArtifact:emit});
    expect(result.contexts.map(row=>row.state)).toEqual(['COMPLETED','COMPLETED','COMPLETED']);
    expect(requests).toContainEqual({path:'/app/admin',method:'GET',role:'user'});expect(requests).toContainEqual({path:'/app/admin',method:'GET',role:'manager'});
    expect(requests.every(row=>row.method==='GET'&&row.path.startsWith('/app/')&&!/logout|outside|\[id\]/i.test(row.path))).toBe(true);
    expect(requests.some(row=>row.path==='/app/preferences')).toBe(false);
    expect(requests.some(row=>row.path==='/app/users/48291?record=private-value')).toBe(true);
    const values=emit.mock.calls.map(call=>call[1]);
    expect(values.some(value=>value.url===origin+'/app/dashboard'&&value.method==='GET')).toBe(true);
    expect(values.some(value=>value.declaredMethod==='POST'&&value.url===origin+'/app/preferences')).toBe(true);
    expect(values.some(value=>value.name==='displayName')).toBe(true);
    expect(JSON.stringify(values)).not.toMatch(/PRIVATE_PII|private-value|48291|statusCode|session=user|session=manager/);
    expect(emit.mock.calls.every(call=>call[2].startsWith('ReconSurfaceObservation:observation:AUTH_'))).toBe(true);
    expect(vi.mocked(recordSurfaceObservation).mock.calls.some(call=>call[2]==='ANONYMOUS')).toBe(true);
  });
  it('stops a lost session at its validation endpoint and never silently retries anonymously',async()=>{
    sessionLost=true;const result=await run([context('AUTH_USER')]);
    expect(result.contexts.find(row=>row.contextKey==='AUTH_USER')).toMatchObject({state:'SKIPPED_SESSION_LOST',reason:'AUTH_CONTEXT_SESSION_LOST'});
    expect(result.contexts.find(row=>row.contextKey==='AUTH_USER')?.failure).toMatchObject({reason:'SESSION_LOST',retryable:false,coverageImpact:'REDUCED',capability:'AUTHENTICATED_MAPPING'});
    expect(requests.filter(row=>row.role==='user')).toEqual([{path:'/app/session',method:'GET',role:'user'}]);expect(result.complete).toBe(false);
  });
  it('reloads sessions before every request and stops a rotation without using cached credentials',async()=>{
    rotate=true;const result=await run([context('AUTH_USER')]);
    expect(result.contexts.find(row=>row.contextKey==='AUTH_USER')).toMatchObject({state:'SKIPPED_SESSION_UNAVAILABLE'});
    expect(requests.filter(row=>row.role==='user')).toEqual([]);
  });
  it('revalidates a login redirect after server-side session loss instead of treating it as covered authenticated content',async()=>{
    expireAfterValidation=true;const result=await run([context('AUTH_USER')]);
    expect(result.contexts.find(row=>row.contextKey==='AUTH_USER')).toMatchObject({state:'SKIPPED_SESSION_LOST'});
    expect(requests.filter(row=>row.role==='user'&&row.path==='/app/session')).toHaveLength(2);
    expect(result.complete).toBe(false);
  });
  it('does not load explicitly unavailable or duplicate identities',async()=>{
    const unavailable={...context('AUTH_EXPIRED'),eligibility:'SESSION_UNAVAILABLE' as const},duplicate={...context('AUTH_DUPLICATE'),eligibility:'AUTH_CONTEXT_DUPLICATE_IDENTITY' as const};
    const result=await run([unavailable,duplicate]);expect(loadReconCredential).not.toHaveBeenCalled();
    expect(result.contexts).toEqual(expect.arrayContaining([expect.objectContaining({contextKey:'AUTH_EXPIRED',state:'SKIPPED_SESSION_UNAVAILABLE'}),expect.objectContaining({contextKey:'AUTH_DUPLICATE',state:'AUTH_CONTEXT_DUPLICATE_IDENTITY'})]));
  });
  it('shares the outer asset budget instead of granting each identity a new allowance',async()=>{
    const budget={remaining:2};const result=await run([context('AUTH_USER'),context('AUTH_MANAGER')],{budget});
    expect(result.requests).toBe(2);expect(budget.remaining).toBe(0);expect(requests).toHaveLength(2);expect(result.complete).toBe(false);
  });
  it('records rate limiting as blocked without leaking a server-controlled error',async()=>{
    rateLimited=true;const result=await run([context('AUTH_USER')]);
    expect(result.contexts.find(row=>row.contextKey==='AUTH_USER')).toMatchObject({state:'BLOCKED',reason:'AUTH_CONTEXT_RATE_LIMITED'});expect(result.complete).toBe(false);
  });
  it('does not launch network traffic after cancellation',async()=>{
    const controller=new AbortController();controller.abort(new Error('Fixture cancelled'));
    await expect(run([context('AUTH_USER')],{signal:controller.signal})).rejects.toThrow('Fixture cancelled');expect(requests).toEqual([]);expect(loadReconCredential).not.toHaveBeenCalled();
  });
  it('stops an already started authenticated mapping without traffic after cancellation settles',async()=>{
    const controller=new AbortController();
    vi.mocked(recordSurfaceObservation).mockImplementation(async(_run,_asset,captured)=>{
      if(captured!=='ANONYMOUS')controller.abort(new Error('Fixture mid-run cancellation'));
      return {id:'observation'} as never;
    });
    await expect(run([context('AUTH_USER'),context('AUTH_MANAGER')],{signal:controller.signal})).rejects.toThrow('Fixture mid-run cancellation');
    expect(requests.some(row=>row.role==='user')).toBe(true);expect(requests.some(row=>row.role==='manager')).toBe(false);
    const settled=requests.length;await new Promise(resolve=>setTimeout(resolve,30));expect(requests).toHaveLength(settled);
  });
});
