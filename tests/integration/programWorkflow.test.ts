import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const mocks=vi.hoisted(()=>({auth:vi.fn(),purge:vi.fn(),command:vi.fn()}));
vi.mock('@/server/scanners/runCommand',()=>({runCommand:mocks.command}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/server/queue/scanQueue',()=>({purgeScanJobs:mocks.purge,deliverScanJob:vi.fn(async()=>({alreadyPresent:false}))}));
vi.mock('@/server/queue/logBus',()=>({publishScanLog:vi.fn(async()=>{})}));
const db=process.env.TEST_DATABASE_URL,schema=`program_${randomUUID().replaceAll('-','')}`;
if(db){const url=new URL(db);url.searchParams.set('schema',schema);process.env.DATABASE_URL=url.toString();}
let p:typeof import('@/lib/prisma').prisma,context:typeof import('@/server/programContext').ensureProgramContext,
  persist:typeof import('@/server/recon/program').persistProgramDiscovery,remove:typeof import('@/server/programDeletion').deleteProgram,
  ensure:typeof import('@/server/research/consoleWorkspace').ensureTargetConsole,root:string,userId:string,programId:string;
(db?describe:describe.skip)('program workflow with real SQL integrity',()=>{
  beforeAll(async()=>{
    execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});
    ({prisma:p}=await import('@/lib/prisma'));({ensureProgramContext:context}=await import('@/server/programContext'));
    ({persistProgramDiscovery:persist}=await import('@/server/recon/program'));({deleteProgram:remove}=await import('@/server/programDeletion'));
    ({ensureTargetConsole:ensure}=await import('@/server/research/consoleWorkspace'));
    root=await mkdtemp(join(tmpdir(),'program-workflow-'));process.env.RESEARCH_CONSOLE_ROOT=root;process.env.RESEARCH_WORKSPACE_ROOT=root;
    const pair=generateKeyPairSync('ed25519');process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE=join(root,'private.pem');await writeFile(process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  },30000);
  beforeEach(async()=>{
    vi.restoreAllMocks();mocks.command.mockReset();mocks.command.mockResolvedValue({code:0,timedOut:false});mocks.purge.mockReset();mocks.purge.mockResolvedValue(undefined);
    userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;mocks.auth.mockResolvedValue({user:{id:userId}});
    programId=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Program without hosts',requiredUserAgent:'Workflow/1',scopeRules:['*.example.test'],outOfScope:['admin.example.test'],rulesOfEngagement:'Passive Recon only; no destructive actions.'}})).id;
  });
  afterAll(async()=>{vi.restoreAllMocks();if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}if(root)await rm(root,{recursive:true,force:true});});
  async function run(){const c=await context(userId,programId);return p.scanRun.create({data:{targetId:c.id,type:'RECON',status:'RUNNING'}});}
  it.each([true,false])('uses locked current policy when another writer adds a scope rule (active Recon: %s)',async(active)=>{
    const {PATCH}=await import('@/app/api/programs/[id]/route');
    let entered!:()=>void,release!:()=>void;
    const observed=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
    const read=p.bountyProgram.findFirst.bind(p.bountyProgram);
    vi.spyOn(p.bountyProgram,'findFirst').mockImplementationOnce(args=>{
      const result=read(args);
      return result.then(async value=>{entered();await gate;return value;}) as typeof result;
    });
    const pending=PATCH(new Request('http://localhost',{method:'PATCH',body:JSON.stringify({scopeRules:['*.example.test']})}),{params:Promise.resolve({id:programId})});
    await observed;
    let assetId='';
    try{
      await p.bountyProgram.update({where:{id:programId},data:{scopeRules:['*.example.test','api.extra.test']}});
      const asset=await p.scopeAsset.create({data:{programId,originalValue:'api.extra.test',normalizedValue:'api.extra.test',format:'SUBDOMAIN',type:'WEB_APPLICATION'}});assetId=asset.id;
      if(active){const target=await context(userId,programId);await p.scanRun.create({data:{targetId:target.id,scopeAssetId:asset.id,type:'RECON',status:'RUNNING'}});}
    }finally{release();}
    expect((await pending).status).toBe(active?409:200);
    expect((await p.scopeAsset.findUniqueOrThrow({where:{id:assetId}})).active).toBe(active);
    expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).scopeRules).toEqual(active?['*.example.test','api.extra.test']:['*.example.test']);
  });
  it('starts from official rules without hosts; persists incrementally, normalizes and deduplicates across concurrent runs and programs',async()=>{
    expect(await p.target.count({where:{programId}})).toBe(0);
    const a=await run();const b=await run();
    const first=await persist(a.id,'API.Example.test.','CERTIFICATE_TRANSPARENCY');expect(first).toMatchObject({host:'api.example.test',state:'VALIDATED',added:true});
    expect(await p.target.count({where:{programId,active:true}})).toBe(1); // Before either Recon finishes.
    await Promise.all([persist(a.id,'api.example.test','CERTIFICATE_TRANSPARENCY'),persist(b.id,'api.example.test','CERTIFICATE_TRANSPARENCY')]);
    expect(await p.target.count({where:{programId,active:true}})).toBe(1);
    expect(await p.hostDiscovery.count({where:{scanRunId:a.id}})).toBe(1);
    const host=await p.target.findFirstOrThrow({where:{programId,active:true}});expect(host.discoveredByScanRunId).toBe(a.id);expect(host.discoveredAt).toBeTruthy();
    const other=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Other target',requiredUserAgent:'Other/1',scopeRules:['*.example.test']}})).id;
    const c=await context(userId,other),r=await p.scanRun.create({data:{targetId:c.id,type:'RECON',status:'RUNNING'}});await persist(r.id,'api.example.test','CERTIFICATE_TRANSPARENCY');
    expect(await p.target.count({where:{host:'api.example.test',active:true,userId}})).toBe(2);
  });
  it('records excluded and foreign discoveries without creating hosts or scan jobs; invalid input creates nothing',async()=>{
    const r=await run();
    for(const [host,state] of [['admin.example.test','EXCLUDED'],['evilexample.test','OUT_OF_SCOPE'],['example.test.evil.test','OUT_OF_SCOPE'],['example.test','OUT_OF_SCOPE']])expect(await persist(r.id,host,'CERTIFICATE_TRANSPARENCY')).toMatchObject({state,added:false});
    for(const input of ['x;touch /tmp/unsafe','https://api.example.test','*.example.test'])expect(await persist(r.id,input,'CERTIFICATE_TRANSPARENCY')).toBeNull();
    expect(await p.target.count({where:{programId,contextOnly:false}})).toBe(0);expect(await p.scanRun.count({where:{target:{programId}}})).toBe(1);
  });
  it.each([
    {rules:['*.example.test'],output:['api.example.test','www.example.test','dev.example.test'],accepted:['api.example.test','dev.example.test','www.example.test'],seeds:['example.test']},
    {rules:['*.example.test'],output:['api.example.test','api.example.test','API.EXAMPLE.TEST.'],accepted:['api.example.test'],seeds:['example.test']},
    {rules:['*.example.test'],output:['api.example.test','api.other.test','example.test.attacker.net','example.test'],accepted:['api.example.test'],seeds:['example.test']},
    {rules:['*.example.test'],output:['api.example.test','admin.example.test','foo.internal.example.test','www.example.test'],accepted:['api.example.test','www.example.test'],seeds:['example.test']},
    {rules:['*.api.example.test'],output:['v1.api.example.test','internal.v2.api.example.test','www.example.test','api.example.test'],accepted:['internal.v2.api.example.test','v1.api.example.test'],seeds:['api.example.test']},
    {rules:['*.example.test','api.other.test','*.services.company.test','example.test'],output:[],accepted:['api.other.test','example.test'],seeds:['example.test','api.other.test','services.company.test']},
    {rules:['api.example.test'],output:[],accepted:['api.example.test'],seeds:['api.example.test']},
  ])('enumerates $rules through the existing wrapper, validates and persists results',async({rules,output,accepted,seeds})=>{
    await p.bountyProgram.update({where:{id:programId},data:{scopeRules:rules,outOfScope:['admin.example.test','*.internal.example.test']}});
    const r=await run();
    mocks.command.mockImplementation(async(_cmd,_args,options)=>{for(const host of output)await options.onStdoutLine(host);return{code:0,timedOut:false};});
    vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('[]'));
    const {runRecon}=await import('@/server/scanners/recon');const {withTargetExecution}=await import('@/server/execution');
    expect(await withTargetExecution({targetId:r.targetId,host:'program.invalid',programReconId:programId,requiredUserAgent:'laziza',qualifying:[],nonQualifying:[]},()=>runRecon('program.invalid',r.id))).toEqual({outcome:'SUCCESS'});
    expect(mocks.command.mock.calls.map(call=>call[0])).toEqual(seeds.map(()=> 'subfinder'));
    expect(mocks.command.mock.calls.map(call=>call[1])).toEqual(seeds.map(seed=>['-d',seed]));
    expect((await p.target.findMany({where:{programId,active:true,contextOnly:false},orderBy:{host:'asc'}})).map(t=>t.host)).toEqual(accepted);
    expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).scopeRules).toEqual(rules);
  });
  it('makes discoveries visible while subfinder is still running and reuses the same job lifecycle',async()=>{
    const r=await run();let release!:()=>void,first!:()=>void;
    const hold=new Promise<void>(resolve=>{release=resolve;}),discovered=new Promise<void>(resolve=>{first=resolve;});
    mocks.command.mockImplementation(async(_cmd,_args,options)=>{await options.onStdoutLine('api.example.test');first();await hold;await options.onStdoutLine('www.example.test');return{code:0,timedOut:false};});
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('[]'));
    const {runRecon}=await import('@/server/scanners/recon');const {withTargetExecution}=await import('@/server/execution');
    const pending=withTargetExecution({targetId:r.targetId,host:'program.invalid',programReconId:programId,requiredUserAgent:'laziza',qualifying:[],nonQualifying:[]},()=>runRecon('program.invalid',r.id));
    await discovered;expect(await p.target.count({where:{programId,host:'api.example.test'}})).toBe(1);expect(await p.target.count({where:{programId,host:'www.example.test'}})).toBe(0);
    release();await pending;expect(await p.target.count({where:{programId,active:true}})).toBe(2);
  });
  it('preserves legacy wildcard identities alongside asset-based Target Recon',async()=>{
    await p.bountyProgram.update({where:{id:programId},data:{scopeRules:[],rulesOfEngagement:null}});
    const {mutateHost}=await import('@/server/programHosts');
    const wildcard=await mutateHost(userId,programId,'ADD',{host:'*.example.test'});
    expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).scopeRules).toEqual(['*.example.test']);
    const {POST:start}=await import('@/app/api/programs/[id]/recon/route');
    const response=await start(new Request('http://localhost',{method:'POST'}),{params:Promise.resolve({id:programId})});expect(response.status).toBe(202);expect((await response.json()).scans).toHaveLength(1);
    expect(await p.target.count({where:{programId,active:true,host:{not:{startsWith:'*.'}}}})).toBe(0);
    const {loadTargetExecution}=await import('@/server/execution');await expect(loadTargetExecution(wildcard.id)).rejects.toThrow();expect((await loadTargetExecution(wildcard.id,'RECON')).programReconId).toBe(programId);
    const edited=await mutateHost(userId,programId,'EDIT',{hostId:wildcard.id,host:'*.api.example.test'});
    expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).scopeRules).toEqual(['*.api.example.test']);
    await mutateHost(userId,programId,'REMOVE',{hostId:edited.id});expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).scopeRules).toEqual([]);
  });
  it('keeps wildcard Recon available after editing only exclusions or User-Agent',async()=>{
    const {PATCH}=await import('@/app/api/programs/[id]/route');
    for(const change of [{outOfScope:['admin.example.test']},{requiredUserAgent:'laziza'}]){
      const response=await PATCH(new Request('http://localhost',{method:'PATCH',body:JSON.stringify(change)}),{params:Promise.resolve({id:programId})});expect(response.status).toBe(200);
      expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).scopeRules).toEqual(['*.example.test']);
    }
  });
  it('rejects buffered late discoveries after cancellation or complete target deletion',async()=>{
    const r=await run();await persist(r.id,'api.example.test','SUBFINDER');
    await p.scanRun.update({where:{id:r.id},data:{cancelRequestedAt:new Date(),status:'CANCELLED'}});
    await expect(persist(r.id,'late.example.test','SUBFINDER')).rejects.toThrow('Recon stopped');
    await remove(userId,programId);await expect(persist(r.id,'later.example.test','SUBFINDER')).rejects.toThrow();
    expect(await p.target.count({where:{programId}})).toBe(0);
  });
  it('repairs only approved, explicitly declared wildcard rules during migration, idempotently',async()=>{
    await p.bountyProgram.update({where:{id:programId},data:{scopeRules:[]}});
    for(const [host,status,source] of [['*.repair.example.test','APPROVED',null],['*.revoked.example.test','REVOKED',null],['*.discovered.example.test','APPROVED','SUBFINDER']] as const){
      const scope=await p.scope.create({data:{userId,hostPattern:host,status}});await p.target.create({data:{programId,userId,scopeId:scope.id,host,discoverySource:source}});
    }
    const sql=await readFile('prisma/migrations/20261028140000_reconcile_wildcard_scope_rules/migration.sql','utf8');
    await p.$executeRawUnsafe(sql);const first=await p.bountyProgram.findUniqueOrThrow({where:{id:programId}});expect(first.scopeRules).toEqual(['*.repair.example.test']);
    await p.$executeRawUnsafe(sql);expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).updatedAt).toEqual(first.updatedAt);
  });
  it('runs the existing Recon entry point in passive program mode and persists a streamed host before enumeration ends',async()=>{
    const r=await run();let stream!:ReadableStreamDefaultController<Uint8Array>;
    const response=new Response(new ReadableStream({start(c){stream=c;c.enqueue(new TextEncoder().encode('[{"name_value":"stream.example.test"},'));}}));
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(response);
    const {runRecon}=await import('@/server/scanners/recon');const {withTargetExecution}=await import('@/server/execution');
    const pending=withTargetExecution({targetId:r.targetId,host:'program.invalid',programReconId:programId,requiredUserAgent:'Workflow/1',qualifying:[],nonQualifying:[]},()=>runRecon('program.invalid',r.id));
    const deadline=Date.now()+2000;
    while(!await p.target.count({where:{programId,host:'stream.example.test',active:true}})){if(Date.now()>deadline)throw new Error('Discovery was not incremental');await new Promise(resolve=>setTimeout(resolve,10));}
    expect((await p.scanRun.findUniqueOrThrow({where:{id:r.id}})).status).toBe('RUNNING');
    stream.enqueue(new TextEncoder().encode('{"name_value":"admin.example.test\\nforeign.test"}]'));stream.close();
    expect(await pending).toEqual({outcome:'SUCCESS'});
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/crt\.sh\//);
    expect(await p.target.count({where:{programId,active:true}})).toBe(1);expect(await p.hostDiscovery.count({where:{scanRunId:r.id}})).toBe(3);
  });
  it('creates a shared-infrastructure program console with no hosts and refreshes inventory without replacing scope or session',async()=>{
    const c=await context(userId,programId),initial=await ensure(userId,c.id),dir=join(root,initial.session.workspaceId);
    const scope=await readFile(join(dir,'scope.md'),'utf8');expect(scope).toContain('*.example.test');expect(scope).toContain('Passive Recon only');
    expect(JSON.parse(await readFile(join(dir,'recon/hosts.json'),'utf8')).hosts).toEqual([]);
    const r=await run();await persist(r.id,'api.example.test','CERTIFICATE_TRANSPARENCY');
    const renewed=await ensure(userId,c.id);expect(renewed.session.id).toBe(initial.session.id);expect(await readFile(join(dir,'scope.md'),'utf8')).toBe(scope);
    expect(JSON.parse(await readFile(join(dir,'recon/hosts.json'),'utf8')).hosts[0].host).toBe('api.example.test');
  });
  it('cleans children, exclusive reports, sessions, credentials, logs, OOB and files while preserving shared resources and another program',async()=>{
    const models:(()=>Promise<number>)[]=[()=>p.scanRun.count(),()=>p.scanLog.count(),()=>p.hostDiscovery.count(),()=>p.targetCredential.count(),()=>p.researchSession.count(),()=>p.researchHypothesis.count(),()=>p.researchHypothesisRevision.count(),()=>p.researchFindingPromotion.count(),()=>p.oobHit.count()];
    const baseline=await Promise.all(models.map(count=>count()));
    const r=await run();await persist(r.id,'api.example.test','CERTIFICATE_TRANSPARENCY');await p.scanRun.update({where:{id:r.id},data:{status:'COMPLETED'}});
    const host=await p.target.findFirstOrThrow({where:{programId,active:true}}),consoleSession=await ensure(userId,r.targetId);
    await p.targetCredential.create({data:{targetId:host.id,label:'Exclusive credential',headerCipher:'synthetic encrypted value'}});
    await p.scanLog.create({data:{scanRunId:r.id,line:'Exclusive log'}});
    const other=await p.bountyProgram.create({data:{ownerId:userId,companyName:'Keep program',requiredUserAgent:'Keep/1'}});
    const sibling=await p.target.create({data:{programId:other.id,userId,host:'keep.example.test',scopeId:host.scopeId}});
    const f=await p.finding.create({data:{targetId:host.id,title:'Exclusive result',oobToken:'exclusive-'+programId}});
    await p.oobHit.create({data:{token:f.oobToken!,method:"GET"}});
    const keep=await p.finding.create({data:{targetId:sibling.id,title:'Keep result'}});
    const shared=await p.report.create({data:{userId,targetId:host.id,title:'Shared report',items:{create:[{findingId:f.id},{findingId:keep.id}]}}});
    await p.report.create({data:{userId,targetId:host.id,title:'Exclusive report',items:{create:{findingId:f.id}}}});
    const hypothesis=await p.researchHypothesis.create({data:{sessionId:consoleSession.session.id,externalId:randomUUID(),title:'Hypothesis',status:'CONFIRMED',hypothesis:'Synthetic',evidenceFor:[],evidenceAgainst:[],nextTest:'Synthetic',expectedSignal:'Synthetic',falsificationCondition:'Synthetic',contentSha256:'a'.repeat(64),revisions:{create:{revision:1,snapshot:{}}}}});
    await p.researchFindingPromotion.create({data:{hypothesisId:hypothesis.id,findingId:f.id,userId,hypothesisRevision:1,snapshot:{}}});
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({stopped:true}));
    await remove(userId,programId);await remove(userId,programId);
    expect(await p.bountyProgram.findUnique({where:{id:programId}})).toBeNull();
    for(const [i,model] of models.entries())expect(await model()).toBe(baseline[i]);
    expect(await p.target.count({where:{programId:other.id}})).toBe(1);expect(await p.scope.findUnique({where:{id:host.scopeId}})).not.toBeNull();
    expect(await p.report.count({where:{userId}})).toBe(1);expect((await p.report.findUniqueOrThrow({where:{id:shared.id}})).targetId).toBeNull();
    await expect(access(join(root,consoleSession.session.workspaceId))).rejects.toThrow();expect(mocks.purge).toHaveBeenCalledWith([r.id]);
  });
  it('keeps a durable tombstone on partial failure, rejects all new launches, retries safely and hides foreign ownership',async()=>{
    const c=await context(userId,programId);await ensure(userId,c.id);
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({error:'offline'},{status:503}));
    await expect(remove(userId,programId)).rejects.toThrow('cleanup unconfirmed');
    expect((await p.bountyProgram.findUniqueOrThrow({where:{id:programId}})).deletingAt).toBeTruthy();
    await expect(context(userId,programId)).rejects.toThrow();await expect(ensure(userId,c.id)).rejects.toThrow('deletion');
    await expect(p.scanRun.create({data:{targetId:c.id,type:'RECON'}})).rejects.toThrow();
    await remove('foreign-user',programId);expect(await p.bountyProgram.findUnique({where:{id:programId}})).not.toBeNull();
    vi.mocked(fetch).mockImplementation(async()=>Response.json({stopped:true}));
    await Promise.all([remove(userId,programId),remove(userId,programId)]);expect(await p.bountyProgram.findUnique({where:{id:programId}})).toBeNull();
  });
  it('waits for a running worker to confirm resource cleanup before deleting scan rows',async()=>{
    await p.bountyProgram.update({where:{id:programId},data:{rulesOfEngagement:null}});
    const c=await context(userId,programId),r=await p.scanRun.create({data:{targetId:c.id,type:'RECON'}});
    const {createScanProcessor}=await import('@/server/queue/processScan');
    const {currentScanControl}=await import('@/server/scanControl');
    let entered!:()=>void,cleaned=false;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    const worker=createScanProcessor('deletion-test-worker',async()=>{
      const control=currentScanControl()!;
      control.track(async()=>{await new Promise(resolve=>setTimeout(resolve,100));cleaned=true;});
      entered();await new Promise<void>((_,reject)=>control.signal.addEventListener('abort',()=>reject(control.signal.reason),{once:true}));
      return {outcome:'SUCCESS'};
    });
    const processing=worker.process({data:{scanRunId:r.id,targetId:c.id,type:'RECON'},attemptsStarted:1} as Parameters<typeof worker.process>[0]);
    await started;await remove(userId,programId);await processing;
    expect(cleaned).toBe(true);expect(await p.scanRun.findUnique({where:{id:r.id}})).toBeNull();
  },10000);
  it.each(['STALE_HEARTBEAT','CLEANUP_UNCONFIRMED'])('does not treat %s as proof that processes stopped; resumes after owner cleanup confirmation',async reason=>{
    const r=await run();await p.scanRun.update({where:{id:r.id},data:{status:'FAILED'}});
    const attempt=await p.scanExecutionAttempt.create({data:{scanRunId:r.id,workerId:'lost-worker',state:'INTERRUPTED',reason}});
    const deleting=remove(userId,programId);
    await new Promise(resolve=>setTimeout(resolve,100));
    expect(await p.scanRun.findUnique({where:{id:r.id}})).not.toBeNull();
    await p.scanExecutionAttempt.update({where:{id:attempt.id},data:{cleanupConfirmedAt:new Date()}});
    await deleting;expect(await p.bountyProgram.findUnique({where:{id:programId}})).toBeNull();
  });
});
