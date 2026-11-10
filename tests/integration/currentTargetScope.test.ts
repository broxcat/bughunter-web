import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='current_scope_'+randomUUID().replaceAll('-','');
if(db){const url=new URL(db);url.searchParams.set('schema',schema);process.env.DATABASE_URL=url.toString();}
let p:typeof import('@/lib/prisma').prisma,service:typeof import('@/server/currentTargetScope'),assets:typeof import('@/server/scopeAssets'),route:typeof import('@/app/api/programs/[id]/scope.md/route').GET;
let owner:string,other:string,programId:string,root:string;
(db?describe:describe.skip)('current Target scope publication and immutable Research snapshots',()=>{
  beforeAll(async()=>{
    execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});
    ({prisma:p}=await import('@/lib/prisma'));service=await import('@/server/currentTargetScope');assets=await import('@/server/scopeAssets');({GET:route}=await import('@/app/api/programs/[id]/scope.md/route'));
    root=await mkdtemp(join(tmpdir(),'current-scope-'));process.env.RESEARCH_CONSOLE_ROOT=root;
    other=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;
  },30000);
  beforeEach(async()=>{
    owner=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;
    programId=(await p.bountyProgram.create({data:{ownerId:owner,companyName:'Current | **Scope**',requiredUserAgent:'Scope-Fixture/1',outOfScope:['excluded.fixture.test'],qualifying:['XSS'],nonQualifying:['DoS'],rulesOfEngagement:'No destructive testing'}})).id;
    mocks.auth.mockResolvedValue({user:{id:owner}});
  });
  afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}if(root)await rm(root,{recursive:true,force:true});});
  const doc=()=>service.currentTargetScope(owner,programId);
  const request=(id=programId)=>route(new Request('http://app.example.test/api/programs/'+id+'/scope.md'),{params:Promise.resolve({id})});
  async function grant(host='app.fixture.test'){
    const scope=await p.scope.create({data:{userId:owner,hostPattern:host,status:'APPROVED',justification:'Operator authorization fixture',accessInfo:'password=PRIVATE_ACCESS_SECRET',outOfScope:'Do not test /admin',rulesOfEngagement:'Read-only tests'}});
    const asset=await p.scopeAsset.create({data:{programId,originalValue:host,normalizedValue:host,format:'SUBDOMAIN',type:'WEB_APPLICATION'}});
    const target=await p.target.create({data:{userId:owner,programId,scopeId:scope.id,scopeAssetId:asset.id,host}});
    return{scope,asset,target};
  }
  async function recon(g:Awaited<ReturnType<typeof grant>>,outcome:'SUCCESS'|'PARTIAL'|'FAILED'|null='SUCCESS'){
    const run=await p.scanRun.create({data:{targetId:g.target.id,scopeAssetId:g.asset.id,type:'RECON',status:'COMPLETED',outcome,finishedAt:new Date(),requiredUserAgent:'Scope-Fixture/1',scopeAssetSnapshot:assets.assetSnapshot(g.asset),reconPlan:{boundary:{normalizedValue:g.asset.normalizedValue},authorization:{exclusions:['excluded.fixture.test']},activityMode:'PASSIVE',stages:[]},reconSteps:{create:{name:'DNS',position:0,state:outcome==='PARTIAL'?'PARTIAL':'COMPLETED',reason:outcome==='PARTIAL'?'Budget exhausted':null}}}});
    const artifact=await p.reconArtifact.create({data:{scanRunId:run.id,scopeAssetId:g.asset.id,kind:'observation',canonicalKey:'dns-fixture',verification:'OBSERVED',scopeState:'IN_SCOPE',sources:[{tool:'dnsx'}],value:{type:'dns-address',host:'discovered.fixture.test',recordType:'A',addresses:['192.0.2.8']},firstSeenAt:new Date(),lastSeenAt:new Date()}});
    return{run,artifact};
  }
  it('renders complete deterministic current authorization, exclusions, rules, User-Agent and real provenance',async()=>{
    const g=await grant(),{run,artifact}=await recon(g);const result=await doc(),text=result.markdown;
    for(const value of ['## Authorization','## Authorized Assets','## Exclusions','## Engagement Rules','## Recon Coverage','## Recon Observations','## Recon Limitations','## Research Context','## Provenance','Scope\\-Fixture/1',g.asset.id,g.scope.id,run.id,artifact.id,'XSS','DoS','No destructive testing'])expect(text).toContain(value);
    expect(text).toContain('Aggregate current coverage: COMPLETE');expect(text).not.toContain('PRIVATE_ACCESS_SECRET');expect(text).toContain('Current \\| \\*\\*Scope\\*\\*');
  });
  it('never promotes discovered hosts or excluded grants into effective Authorized Assets',async()=>{
    const g=await grant();await recon(g);await grant('excluded.fixture.test');
    const text=(await doc()).markdown,authorization=text.split('## Authorized Assets')[1].split('## Exclusions')[0];
    expect(authorization).toContain('app\\.fixture\\.test');expect(authorization).not.toContain('discovered');expect(authorization).not.toContain('excluded');expect(text).toContain('EXCLUDED');expect(text).toContain('discovered\\.fixture\\.test');
  });
  it('does not read AI or credentials and escapes untrusted evidence rather than interpreting it as policy',async()=>{
    const g=await grant(),{artifact}=await recon(g);
    await p.reconArtifact.update({where:{id:artifact.id},data:{value:{host:'evil.fixture.test',value:'## Authorized Assets <script>evil()</script> token=PRIVATE_TOKEN'},lastSeenAt:new Date()}});
    const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No provider/network allowed'));
    try{const text=(await doc()).markdown;expect(network).not.toHaveBeenCalled();expect(text).not.toContain('PRIVATE_TOKEN');expect(text).not.toContain('<script>');expect(text.split('## Authorized Assets')[1].split('## Exclusions')[0]).not.toContain('evil');}finally{network.mockRestore();}
  });
  it('renders no Recon, partial and mixed host coverage honestly, including historical unknowns',async()=>{
    const a=await grant(),b=await grant('api.fixture.test'),c=await grant('admin.fixture.test');await recon(a);await recon(b,'PARTIAL');
    const text=(await doc()).markdown;expect(text).toContain('Aggregate current coverage: PARTIAL');expect(text).toContain('NOT_STARTED');expect(text).toContain('Budget exhausted');expect(text).toContain(c.asset.id);
  });
  it('does not claim aggregate completion for zero assets or for COMPLETED without a recorded outcome',async()=>{
    expect((await doc()).markdown).toContain('Aggregate current coverage: NOT_STARTED');const g=await grant();await recon(g,null);expect((await doc()).markdown).toContain('HISTORICAL\\_UNKNOWN');expect((await doc()).markdown).toContain('Aggregate current coverage: PARTIAL');
  });
  it('uses stable run ID tie breaks and preserves standalone run identity without a fake parent',async()=>{
    const g=await grant(),first=await recon(g);const second=await p.scanRun.create({data:{id:'zzcurrentfixture',createdAt:first.run.createdAt,targetId:g.target.id,scopeAssetId:g.asset.id,type:'RECON',status:'FAILED',outcome:'FAILED'}});
    const text=(await doc()).markdown;expect(text).toContain(second.id);expect(text).not.toContain(first.artifact.id);expect(text).toContain('Standalone retained run');
  });
  it('includes all declarations and coverage beyond the bounded detailed Recon context',async()=>{
    await p.scopeAsset.createMany({data:Array.from({length:75},(_,i)=>({programId,originalValue:`host${i}.fixture.test`,normalizedValue:`host${i}.fixture.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION'}))});
    const result=await doc();expect(result.markdown).toContain('All 75 current declarations');expect(result.markdown).toContain('host74\\.fixture\\.test');expect(result.markdown.match(/\| NOT\\_STARTED \|/g)?.length).toBe(75);
  });
  it('caches identical revisions without rebuilding evidence, changing policy timestamp or stable export ETag',async()=>{
    await grant();const before=await p.bountyProgram.findUniqueOrThrow({where:{id:programId}}),first=await doc();
    const second=await service.withCurrentScopeTestHook(async()=>{throw Error('Unexpected rebuild');},doc);
    expect(second).toEqual(first);expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).updatedAt).toEqual(before.updatedAt);
    const response=await request();expect(response.status).toBe(200);expect(response.headers.get('etag')).toBe('"'+first.markdownSha256+'"');expect(response.headers.get('x-bughunter-scope-version')).toBe('3');expect(response.headers.get('content-disposition')).toContain('-scope.md');
  });
  it('invalidates current revision after User-Agent, exclusion, attestation and retirement updates',async()=>{
    const g=await grant();await recon(g);const before=await doc();await p.bountyProgram.update({where:{id:programId},data:{requiredUserAgent:'Scope-Fixture/2',outOfScope:['app.fixture.test']}});
    const after=await doc();expect(after.policyFingerprint).not.toBe(before.policyFingerprint);expect(after.markdown).toContain('Scope\\-Fixture/2');expect(after.markdown).toContain('POLICY\\_CHANGED');expect(after.markdown).toContain('EXCLUDED');
    await p.scope.update({where:{id:g.scope.id},data:{status:'REVOKED',rulesOfEngagement:'Stop now'}});expect((await doc()).markdown).toContain('authorization revoked');
    await assets.editScopeAsset(owner,programId,g.asset.id,null);expect((await doc()).markdown).not.toContain(g.asset.id);
  });
  it('keeps historical unknown metadata unknown and never changes retained Recon scope Markdown',async()=>{
    const g=await grant(),{run}=await recon(g);await p.scanRun.update({where:{id:run.id},data:{requiredUserAgent:null,scopeAssetSnapshot:{normalizedValue:g.asset.normalizedValue},reconPlan:{},scopeMarkdown:'IMMUTABLE HISTORICAL UNKNOWN',scopeMarkdownSha256:'historical'}});
    const text=(await doc()).markdown;expect(text).toContain('HISTORICAL\\_UNKNOWN');expect((await p.scanRun.findUniqueOrThrow({where:{id:run.id}})).scopeMarkdown).toBe('IMMUTABLE HISTORICAL UNKNOWN');
  });
  it('publishes one coherent new revision after Scope replacement races with generation',async()=>{
    const g=await grant();let injected=false;
    const result=await service.withCurrentScopeTestHook(async phase=>{if(phase==='built'&&!injected){injected=true;await assets.replaceScopeAsset(owner,programId,g.asset.id,{value:'replacement.fixture.test',assetValue:'MEDIUM',expectedUpdatedAt:g.asset.updatedAt.toISOString()});}},doc);
    expect(result.markdown).toContain('replacement\\.fixture\\.test');expect(result.markdown).not.toContain(g.asset.id);expect((await p.scopeAsset.findUniqueOrThrow({where:{id:g.asset.id}})).active).toBe(false);
  });
  it.each([{exclusions:['app.fixture.test']},{exclusions:[]}])('rebuilds after exclusions race: %j',async({exclusions})=>{
    await grant();let once=false;
    const result=await service.withCurrentScopeTestHook(async phase=>{if(phase==='built'&&!once){once=true;await p.bountyProgram.update({where:{id:programId},data:{outOfScope:exclusions}});}},doc);
    expect(result.policyFingerprint).toBe((await doc()).policyFingerprint);expect(result.markdown.includes('EXCLUDED')).toBe(exclusions.length>0);
  });
  it('rebuilds when Recon finishes while policy changes and does not label stale coverage complete',async()=>{
    const g=await grant(),run=await p.scanRun.create({data:{targetId:g.target.id,scopeAssetId:g.asset.id,type:'RECON',status:'RUNNING',requiredUserAgent:'Scope-Fixture/1',scopeAssetSnapshot:assets.assetSnapshot(g.asset)}});let once=false;
    const result=await service.withCurrentScopeTestHook(async phase=>{if(phase==='built'&&!once){once=true;await p.$transaction([p.scanRun.update({where:{id:run.id},data:{status:'COMPLETED',outcome:'SUCCESS',finishedAt:new Date()}}),p.bountyProgram.update({where:{id:programId},data:{requiredUserAgent:'Changed-UA'}})]);}},doc);
    expect(result.markdown).toContain('POLICY\\_CHANGED');expect(result.markdown).toContain('Aggregate current coverage: PARTIAL');expect(result.markdown).not.toContain('| RUNNING |');
  });
  it('serializes simultaneous regenerations and returns one authoritative document',async()=>{
    await grant();let count=0,release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
    const work=()=>service.withCurrentScopeTestHook(async phase=>{if(phase==='built'){if(++count===2)release();await barrier;}},doc);
    const [a,b]=await Promise.all([work(),work()]);expect(a).toEqual(b);expect(await p.targetScopeContext.count({where:{programId}})).toBe(1);
  });
  it.each(['built','beforePublish','writtenInTransaction'] as const)('failure at %s preserves prior valid document atomically and refuses stale current policy',async failedPhase=>{
    await grant();const before=await doc();await p.bountyProgram.update({where:{id:programId},data:{requiredUserAgent:'NEW-UA'}});
    await expect(service.withCurrentScopeTestHook(async phase=>{if(phase===failedPhase)throw Error('Injected storage interruption');},doc)).rejects.toThrow('Injected storage');
    expect(await p.targetScopeContext.findUniqueOrThrow({where:{programId}})).toEqual(before);const after=await doc();expect(after.policyFingerprint).not.toBe(before.policyFingerprint);expect(after.markdown).toContain('NEW\\-UA');
  });
  it('fails boundedly under continuous policy churn without publishing a mixed or stale revision',async()=>{
    await grant();const before=await doc();await p.bountyProgram.update({where:{id:programId},data:{requiredUserAgent:'New-UA'}});let i=0;
    await expect(service.withCurrentScopeTestHook(async phase=>{if(phase==='built')await p.bountyProgram.update({where:{id:programId},data:{requiredUserAgent:'Churn-'+(++i)}});},doc)).rejects.toMatchObject({status:409});
    expect(i).toBe(3);expect(await p.targetScopeContext.findUniqueOrThrow({where:{programId}})).toEqual(before);
  });
  it('invalidates cached observations after retained evidence backfill',async()=>{
    const g=await grant(),{artifact}=await recon(g),before=await doc();await p.reconArtifact.update({where:{id:artifact.id},data:{lastSeenAt:new Date(Date.now()+1000),value:{host:'second.fixture.test',addresses:['192.0.2.9']}}});
    const after=await doc();expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint);expect(after.policyFingerprint).toBe(before.policyFingerprint);expect(after.markdown).toContain('second\\.fixture\\.test');
  });
  it('does no filesystem publication and cannot follow symlinks/traversal into Research',async()=>{
    const canary=join(root,'canary-'+randomUUID());await writeFile(canary,'DO NOT CHANGE');await symlink(canary,join(root,'scope.md'));await grant();await doc();expect(await readFile(canary,'utf8')).toBe('DO NOT CHANGE');
    for(const id of ['../scope.md','%2e%2e',randomUUID()])expect((await request(id)).status).toBe(404);
  });
  it('enforces anonymous/private ownership, revoked attestation and retiring program independently of cache',async()=>{
    const g=await grant();await doc();mocks.auth.mockResolvedValue(null);expect((await request()).status).toBe(401);mocks.auth.mockResolvedValue({user:{id:other}});expect((await request()).status).toBe(404);mocks.auth.mockResolvedValue({user:{id:owner}});
    await p.scope.update({where:{id:g.scope.id},data:{status:'REVOKED'}});expect((await doc()).markdown).toContain('BLOCKED');await p.bountyProgram.update({where:{id:programId},data:{deletingAt:new Date()}});expect((await doc()).markdown).toContain('RETIRING');
  });
  it('uses existing explicit legacy backfill without ever admitting discovered/context-only hosts',async()=>{
    const scope=await p.scope.create({data:{userId:owner,hostPattern:'*.fixture.test',status:'APPROVED'}});
    await p.bountyProgram.update({where:{id:programId},data:{scopeRules:['official.fixture.test']}});
    await p.target.createMany({data:[{host:'legacy.fixture.test'},{host:'discovered.fixture.test',discoverySource:'SUBFINDER'},{host:'context.fixture.test',contextOnly:true}].map(t=>({...t,userId:owner,scopeId:scope.id,programId}))});
    const text=(await doc()).markdown;expect(text).toContain('official\\.fixture\\.test');expect(text).toContain('legacy\\.fixture\\.test');expect(text).not.toContain('discovered\\.fixture\\.test');expect(text).not.toContain('context\\.fixture\\.test');
  });
  it('rebuilds after a direct Scope policy edit races and preserves its real authorization provenance',async()=>{
    const g=await grant();let once=false;const result=await service.withCurrentScopeTestHook(async phase=>{if(phase==='built'&&!once){once=true;await p.scope.update({where:{id:g.scope.id},data:{outOfScope:'No /billing',rulesOfEngagement:'Updated read-only rules'}});}},doc);
    expect(result.markdown).toContain('No /billing');expect(result.markdown).toContain('Updated read\\-only rules');expect(result.policyFingerprint).toBe((await doc()).policyFingerprint);
  });
  it('fails boundedly on a held native Target lock instead of deadlocking Research authorization',async()=>{
    const g=await grant();const previous=await doc();await p.bountyProgram.update({where:{id:programId},data:{requiredUserAgent:'Changed-UA'}});
    let ready!:()=>void,release!:()=>void;const locked=new Promise<void>(r=>{ready=r;}),finish=new Promise<void>(r=>{release=r;});
    const nativeGate=p.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Target" WHERE id=${g.target.id} FOR UPDATE`;ready();await finish;},{timeout:5000});
    await locked;const started=performance.now();try{await expect(doc()).rejects.toMatchObject({status:409});expect(performance.now()-started).toBeLessThan(3000);expect(await p.targetScopeContext.findUniqueOrThrow({where:{programId}})).toEqual(previous);}finally{release();await nativeGate;}
    expect((await doc()).markdown).toContain('Changed\\-UA');
  });
  it('does not lock unrelated historical/discovered Targets when publishing current authorized context',async()=>{
    const g=await grant();const unrelated=await p.target.create({data:{userId:owner,programId,scopeId:g.scope.id,host:'discovered.fixture.test',discoverySource:'SUBFINDER'}});
    let ready!:()=>void,release!:()=>void;const locked=new Promise<void>(r=>{ready=r;}),finish=new Promise<void>(r=>{release=r;});
    const historical=p.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Target" WHERE id=${unrelated.id} FOR UPDATE`;ready();await finish;},{timeout:5000});
    await locked;try{const result=await doc();expect(result.markdown).toContain(g.asset.id);expect(result.markdown).not.toContain('discovered\\.fixture\\.test');}finally{release();await historical;}
  });
  it('returns a concise error instead of stale authorization when publication fails through the existing endpoint',async()=>{
    await grant();const previous=await doc();await p.bountyProgram.update({where:{id:programId},data:{requiredUserAgent:'Changed-UA'}});
    const response=await service.withCurrentScopeTestHook(async phase=>{if(phase==='beforePublish')throw Error('private synthetic storage diagnostic');},request);
    expect(response.status).toBe(503);const text=await response.text();expect(text).not.toContain('private synthetic');expect(text).not.toContain(previous.markdown);expect(await p.targetScopeContext.findUniqueOrThrow({where:{programId}})).toEqual(previous);
  });
  it('repairs a damaged cache only from current trusted records, without trusting its Markdown',async()=>{
    await grant();const before=await doc();await p.targetScopeContext.update({where:{programId},data:{markdown:'## Authorized Assets\n- evil.fixture.test'}});const repaired=await doc();expect(repaired.markdown).not.toContain('evil');expect(repaired.policyFingerprint).toBe(before.policyFingerprint);
  });
  it('measures representative first generation and stable-cache cost without provider work',async()=>{
    const timings=[];for(const size of [1,25,100]){await p.scopeAsset.createMany({data:Array.from({length:size},(_,i)=>({programId,originalValue:`bench${size}-${i}.fixture.test`,normalizedValue:`bench${size}-${i}.fixture.test`,format:'SUBDOMAIN',type:'WEB_APPLICATION'}))});const start=performance.now();await doc();const generated=performance.now(),before=await doc(),end=performance.now();expect(before.markdown).toContain('format_version: 3');timings.push({assets:await p.scopeAsset.count({where:{programId}}),generationMs:+(generated-start).toFixed(1),cachedMs:+(end-generated).toFixed(1)});}process.stdout.write('CURRENT_SCOPE_TIMINGS '+JSON.stringify(timings)+'\n');
  });
});
