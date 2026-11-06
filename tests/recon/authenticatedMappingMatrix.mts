// Actual guarded HTTP mapping; deliberately no CLI/worker claim. Setup reuses
// the existing verified cookie/Bearer/login flow, then all eight cases share
// those established sessions. Everything lives in this runner's disposable DB.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encryptSecret} from '@/lib/crypto';
import {createScopeAsset,ensureAssetExecution} from '@/server/scopeAssets';
import {testStoredConnection} from '@/server/credentials/connection';
import {captureAuthenticatedContexts,readAuthSurface} from '@/server/authenticatedRecon';
import {loadTargetExecution,withTargetExecution} from '@/server/execution';
import {mapAuthenticatedSurfaces} from '@/server/recon/authenticatedMapping';
import {buildReconPlan} from '@/lib/reconPlanner';
import {fixtureAccounts} from './authenticatedFixture.mjs';

assert.equal(process.env.BH_DISPOSABLE_AUTH_RECON,'1');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/authenticated_recon_test');
const base='http://auth.fixture.test:8081/app/';
const json=(value:unknown)=>value as Prisma.InputJsonValue;
try{
  for(let attempt=0;;attempt++){try{if((await fetch(base)).ok)break;}catch{}assert(attempt<100,'Local fixture unavailable');await new Promise(r=>setTimeout(r,100));}
  const owner=await prisma.user.create({data:{email:randomUUID()+'@example.test'}});
  const create=async(type:'WEB_APPLICATION'|'API')=>{
    const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Authenticated mapping matrix '+type,requiredUserAgent:'Auth-Matrix-Fixture/1'}});
    const asset=await createScopeAsset(owner.id,program.id,{value:base,type,assetValue:'MEDIUM'}),{target}=await ensureAssetExecution(owner.id,program.id,asset.id);return {program,asset,target};
  };
  const web=await create('WEB_APPLICATION'),api=await create('API');
  const minted=await prisma.targetCredential.create({data:{targetId:web.target.id,label:'Existing login session',mode:'EMAIL_PASSWORD',purpose:'ACCOUNT_A',persona:'User',emailCipher:encryptSecret(fixtureAccounts.user.username),passwordCipher:encryptSecret(fixtureAccounts.user.password)}});
  assert.equal((await testStoredConnection(web.target.id,minted.id)).status,'VALID');
  const cookie=await prisma.targetCredential.create({data:{targetId:web.target.id,label:'Explicit cookie session',mode:'COOKIES',purpose:'SESSION_COOKIE',persona:'User',cookiesCipher:encryptSecret(JSON.stringify({fixture_session:fixtureAccounts.user.cookie}))}});
  assert.equal((await testStoredConnection(web.target.id,cookie.id)).status,'VALID');
  const manager=await prisma.targetCredential.create({data:{targetId:web.target.id,label:'Manager session',mode:'BEARER',purpose:'ACCOUNT_B',persona:'Manager',headerCipher:encryptSecret(fixtureAccounts.manager.bearer)}});
  assert.equal((await testStoredConnection(web.target.id,manager.id)).status,'VALID');
  const apiBearer=await prisma.targetCredential.create({data:{targetId:api.target.id,label:'API bearer session',mode:'BEARER',purpose:'JWT',persona:'Manager',headerCipher:encryptSecret(fixtureAccounts.manager.bearer)}});
  assert.equal((await testStoredConnection(api.target.id,apiBearer.id)).status,'VALID');
  const before=await(await fetch('http://auth.fixture.test:8081/__observations')).json() as {method:string}[],loginCount=before.filter(row=>row.method==='POST').length;
  const cases=[
    {name:'BLACK_BOX / anonymous only',mode:'BLACK_BOX',data:web,credentials:[]},
    {name:'BLACK_BOX / explicit cookies',mode:'BLACK_BOX',data:web,credentials:[cookie.id]},
    {name:'BLACK_BOX / existing EMAIL_PASSWORD session',mode:'BLACK_BOX',data:web,credentials:[minted.id]},
    {name:'BLACK_BOX / API bearer',mode:'BLACK_BOX',data:api,credentials:[apiBearer.id]},
    {name:'BLACK_BOX / two verified contexts',mode:'BLACK_BOX',data:web,credentials:[minted.id,manager.id]},
  ] as const;
  for(const test of cases){
    assert.equal((await prisma.bountyProgram.findUniqueOrThrow({where:{id:test.data.program.id}})).assessmentMode,'BLACK_BOX');
    await prisma.targetCredential.updateMany({where:{targetId:test.data.target.id},data:{reconEnabled:false}});
    if(test.credentials.length)await prisma.targetCredential.updateMany({where:{id:{in:[...test.credentials]}},data:{reconEnabled:true}});
    const snapshot=await prisma.$transaction(tx=>captureAuthenticatedContexts(tx,test.data.target.id));assert.equal(snapshot.contexts.length,test.credentials.length);
    const plan=buildReconPlan(test.data.asset,{active:true,exclusions:[]},{authenticatedContexts:test.credentials.length});assert.equal(plan.type,test.data.asset.type);
    const scan=await prisma.scanRun.create({data:{targetId:test.data.target.id,scopeAssetId:test.data.asset.id,type:'RECON',status:'RUNNING',assessmentModeSnapshot:test.mode,assessmentSourcesSnapshot:[],authenticatedContextsSnapshot:json(snapshot),reconPlan:json(plan)}});
    const execution=await loadTargetExecution(test.data.target.id),result=await withTargetExecution(execution,()=>mapAuthenticatedSurfaces({scanRunId:scan.id,scopeAssetId:test.data.asset.id,snapshot,plan,signal:new AbortController().signal,seeds:[base],budget:{remaining:plan.authenticatedMapping!.maxRequests},browser:false}));
    assert(result.complete);assert(result.contexts.every(context=>context.state==='COMPLETED'));assert(result.requests<=plan.authenticatedMapping!.maxRequests);
    await prisma.scanRun.update({where:{id:scan.id},data:{status:'COMPLETED',outcome:'SUCCESS',authenticatedReconResult:json(result)}});
    const [surface]=await readAuthSurface([scan.id]);assert.equal(surface.contexts.length,1+test.credentials.length);
    assert(surface.surfaceVisibility.some(row=>new URL(row.url).pathname==='/app/public'&&row.classifications.includes('PUBLIC')));
    if(!test.credentials.length)assert(surface.observations.every(row=>row.contextType==='ANONYMOUS'));
    else{
      assert(surface.surfaceVisibility.some(row=>new URL(row.url).pathname==='/app/dashboard'&&row.classifications.includes('AUTHENTICATED_ONLY')));
      if(test.data.asset.type==='API')assert(surface.observations.some(row=>new URL(row.url).pathname==='/app/api/me'&&row.contextType==='AUTHENTICATED'&&row.statusCode===200&&row.contentType==='application/json'));
      if(test.credentials.length===2)assert(surface.surfaceVisibility.some(row=>new URL(row.url).pathname==='/app/admin'&&row.classifications.includes('CONTEXT_DIFFERENTIAL')));
    }
    const text=JSON.stringify(surface);for(const account of Object.values(fixtureAccounts))for(const secret of [account.password,account.cookie,account.bearer])assert(!text.includes(secret));
    const immutable=await prisma.scanRun.findUniqueOrThrow({where:{id:scan.id}});assert.deepEqual(immutable.authenticatedContextsSnapshot,scan.authenticatedContextsSnapshot);
    console.log(JSON.stringify({acceptance:'authenticated-recon',phase:'mapping-matrix',case:test.name,status:'PASS',transport:'actual-guarded-native-GET',cliInvoked:false,requests:result.requests,contexts:surface.contexts.length,observations:surface.observations.length,differentials:surface.totals.contextDifferentials}));
  }
  const requests=await(await fetch('http://auth.fixture.test:8081/__observations')).json() as {host:string;path:string;method:string}[];
  assert.equal(requests.filter(row=>row.method==='POST').length,loginCount);assert(requests.every(row=>row.host==='auth.fixture.test:8081'&&row.path.startsWith('/app/')));assert(!requests.some(row=>/\/(?:logout|delete|transfer)$/.test(row.path)));assert.equal(await prisma.scanLog.count(),0);assert.equal(await prisma.scanExecutionAttempt.count(),0);assert.equal(await prisma.finding.count(),0);assert.equal(await prisma.aiProviderConfig.count(),0);
  console.log(JSON.stringify({acceptance:'authenticated-recon',phase:'mapping-matrix-isolation',status:'PASS',cases:cases.length,loginDuringMapping:false,scannersInvoked:false,findingsCreated:0,modelCalls:0}));
}finally{await prisma.$disconnect();}
process.exit(0);
