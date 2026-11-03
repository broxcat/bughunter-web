import { Resolver } from 'node:dns/promises';
import { connect } from 'node:tls';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildReconPlan, rankReconHost, type ReconPlan } from '@/lib/reconPlanner';
import { assetAllowsUrl } from '@/lib/scopeAssets';
import { isSafeReadUrl, safeObservationUrl } from '@/lib/observationSafety';
import { currentTargetExecution,withTargetExecution } from '../execution';
import { beforeScanNetwork,currentScanControl,recordUsefulScanWork,throwIfScanAborted } from '../scanControl';
import { runCommand } from '../scanners/runCommand';
import { assetHostAllowed } from '../scopeAssets';
import { analyzeCorpus } from './corpus';
import { recordArtifact,artifactData,artifactSelect } from './artifacts';
import { reconDiff, type ArtifactKind } from '@/lib/reconArtifacts';
import { parseGobuster,parsePassive,parseHttpx,parseFfuf,parseNmap,parseNuclei,type ParsedRecon } from './parsers';
import { inspectToolchain,type ToolStatus } from './toolchain';
import { createReconRelay } from './transport';
import { ReconProtection } from './protection';
import { withReconToolLease } from './toolLimits';
import { RECON_TEMPLATE_IDS,RECON_TEMPLATE_VERSION } from './nucleiPolicy';
import { persistProgramDiscovery } from './program';
import type { ScanExecutionResult } from '../scanners/result';
import type { ProbeResult } from '../scanners/http';

export async function assertLiveAsset() {
  const execution=currentTargetExecution(),boundary=execution.scopeAsset??execution.parentScopeAsset;if(!boundary)throw new Error('Asset context required');
  const asset=await prisma.scopeAsset.findUnique({where:{id:boundary.id},include:{program:true,executionTarget:{include:{scope:true}}}});
  if(!asset||!asset.active||asset.program.deletingAt||(!execution.reconPlan && asset.normalizedValue!==boundary.normalizedValue)||asset.executionTarget?.scope.status!=='APPROVED')throw new Error('Scope asset authorization changed');
  const effective=execution.reconPlan ? {...asset,...boundary,format:execution.reconPlan.format as typeof asset.format,type:execution.reconPlan.type as typeof asset.type,assetValue:execution.reconPlan.assetValue} : asset;
  if(!execution.programReconId&&!assetHostAllowed(effective,execution.host.split(':')[0],asset.program.outOfScope))throw new Error('Host is outside current asset scope');
  return effective;
}
export async function runAssetRecon(scanRunId:string):Promise<ScanExecutionResult> {
  const initial=currentTargetExecution(),asset=await assertLiveAsset();
  const saved=await prisma.scanRun.findUniqueOrThrow({where:{id:scanRunId},select:{reconPlan:true,scopeAssetSnapshot:true}});
  const captured=saved.scopeAssetSnapshot as {type?:string;assetValue?:string}|null;
  const plan=(saved.reconPlan as ReconPlan|null)??buildReconPlan({...asset,type:captured?.type??asset.type,assetValue:captured?.assetValue??asset.assetValue},{active:true,exclusions:asset.program.outOfScope});
  const temp=await mkdtemp(join(tmpdir(),'bughunter-recon-')),timeout=AbortSignal.timeout(plan.limits.maxDurationMs),signal=AbortSignal.any([timeout,...(currentScanControl()?[currentScanControl()!.signal]:[])]);
  const execution={...initial,reconPlan:plan,reconTempDir:temp};
  let incomplete=false,toolchain:Record<string,ToolStatus>={},activeTool:AbortController|undefined,bounded=false;
  const budget={remaining:plan.limits.maxRequests},hosts=new Map<string,{resolved:boolean;alive:boolean;url?:string;rank:ReturnType<typeof rankReconHost>;pages:Map<string,ProbeResult>}>();
  const stage=async(name:ReconPlan['stages'][number]['name'],work:()=>Promise<void>,skip?:string)=>{
    signal.throwIfAborted();throwIfScanAborted();const p=plan.stages.find(s=>s.name===name)!;
    if(!p.enabled||skip){await prisma.reconPipelineStep.update({where:{scanRunId_name:{scanRunId,name}},data:{state:'SKIPPED',reason:skip??p.reason,finishedAt:new Date()}});return;}
    await assertLiveAsset();await prisma.reconPipelineStep.update({where:{scanRunId_name:{scanRunId,name}},data:{state:'RUNNING',startedAt:new Date()}});
    try{await work();await prisma.reconPipelineStep.update({where:{scanRunId_name:{scanRunId,name}},data:{state:'COMPLETED',finishedAt:new Date()}});}
    catch(e){throwIfScanAborted();incomplete=true;const reason=e instanceof Error?e.message:'Step incomplete';await prisma.reconPipelineStep.update({where:{scanRunId_name:{scanRunId,name}},data:{state:reason.startsWith('BLOCKED')?'BLOCKED':reason.startsWith('PARTIAL')?'PARTIAL':'FAILED',reason:reason.slice(0,300),finishedAt:new Date()}});}
  };
  const add=async(kind:ArtifactKind,value:Record<string,unknown>,tool:string,observed=false,provider?:string)=>{
    signal.throwIfAborted();throwIfScanAborted();
    const row=await recordArtifact(scanRunId,asset,asset.program.outOfScope,kind,value,{tool,sourceRef:`ScanRun:${scanRunId}:${tool}`,observedAt:tool==='burp'&&typeof value.originalObservedAt==='string'&&Number.isFinite(Date.parse(value.originalObservedAt))?value.originalObservedAt:new Date().toISOString(),...(toolchain[tool]?{version:toolchain[tool].version}:{}),...(provider?{provider}:{})},observed?'OBSERVED':'DISCOVERED');
    if(row){await recordUsefulScanWork();}return row;
  };
  const rows=async(items:ParsedRecon[],tool:string)=>{for(const item of items)await add(item.kind,item.value,tool,item.observed,item.provider);};
  const command=async(tool:string,args:string[],onLine:(line:string)=>Promise<void>,seconds=30)=>{
    await assertLiveAsset();signal.throwIfAborted();const status=toolchain[tool];if(!status?.available||!status.capable)throw new Error(`PARTIAL: ${tool}: ${status?.reason??'Tool unavailable'}`);
    const controller=new AbortController();activeTool=controller;
    try {
      const result=await withReconToolLease(tool,signal,leaseSignal=>runCommand(tool,args,{scanRunId,timeoutMs:Math.min(seconds*1000,plan.limits.maxDurationMs),signal:AbortSignal.any([leaseSignal,controller.signal]),onStdoutLine:onLine,
        onStderrLine:async line=>{if(/stopp(?:ed|ing).*(?:403|429|error)|rate.limit|too many requests/i.test(line)){controller.abort();throw new Error('BLOCKED: Scanner reported blocking / excessive errors');}}}));
      if(result.spawnFailed||result.timedOut||result.code!==0||result.cancelled)throw new Error(`PARTIAL: ${tool} ${result.timedOut?'timeout':result.spawnFailed?'unavailable':'incomplete execution'}`);
    }finally{activeTool=undefined;}
  };
  const inventory=async(host:string)=>{if(!hosts.has(host))hosts.set(host,{resolved:false,alive:false,rank:rankReconHost(host),pages:new Map()});};
  await prisma.scanRun.update({where:{id:scanRunId},data:{reconPlan:plan as unknown as Prisma.InputJsonValue}});
  await prisma.reconPipelineStep.createMany({data:plan.stages.map((s,position)=>({scanRunId,name:s.name,position,reason:s.reason})),skipDuplicates:true});
  try {await withTargetExecution(execution,async()=>{
    await stage('Preflight',async()=>{toolchain=await inspectToolchain();await prisma.scanRun.update({where:{id:scanRunId},data:{toolVersions:toolchain as unknown as Prisma.InputJsonValue}});if(!plan.stages.some(s=>s.enabled&&s.mode==='ACTIVE')&&plan.activityMode!=='PASSIVE')throw new Error('No effective authorization');});
    await stage('Passive discovery',async()=>{
      const seed=asset.normalizedValue.slice(2);let failed=false;
      for(const tool of ['subfinder','amass','assetfinder'])try {
        await command(tool,[seed],async line=>{for(const item of parsePassive(tool,line)){
          const row=await add(item.kind,item.value,tool,false,item.provider);if(!row)continue;
          const host=String(row.value.hostname);await persistProgramDiscovery(scanRunId,host,tool.toUpperCase());
          if(row.scopeState==='IN_SCOPE'){if(hosts.size>=plan.limits.maxHosts){bounded=true;continue;}await inventory(host);}
        }},plan.limits.passiveSeconds);
      }catch{throwIfScanAborted();failed=true;}
      if(failed)throw new Error('PARTIAL: Some passive sources failed or are unavailable; successful source artifacts retained.');
    });
    if(asset.format==='WILDCARD_DOMAIN') {
      const inventoryRows=await prisma.reconArtifact.findMany({where:{scanRunId,kind:'hostname',scopeState:'IN_SCOPE'},select:{value:true},take:10000,orderBy:{canonicalKey:'asc'}});
      const candidates=[...new Set(inventoryRows.map(r=>String((r.value as {hostname?:string}).hostname??'')))].filter(h=>assetHostAllowed(asset,h,asset.program.outOfScope)).sort((a,b)=>rankReconHost(b).score-rankReconHost(a).score||a.localeCompare(b));
      hosts.clear();bounded||=candidates.length>plan.limits.maxHosts;for(const host of candidates.slice(0,plan.limits.maxHosts))await inventory(host);
    }
    if(asset.format!=='WILDCARD_DOMAIN')await inventory(asset.format==='URL'?new URL(asset.normalizedValue).hostname:asset.normalizedValue);
    await stage('Scope validation / DNS',async()=>{
      let dnsFailed=false;
      if(plan.gobuster?.dns){
        const {createReconDnsRelay}=await import('./dnsRelay');const relay=await createReconDnsRelay(plan,signal,assertLiveAsset);
        const path=join(temp,'dns-profile.txt');await writeFile(path,['api','auth','portal','admin','www','dev','staging','docs'].slice(0,plan.gobuster.words).join('\n')+'\n',{mode:0o600});
        try{await withTargetExecution({...currentTargetExecution(),gobusterWordlist:path,gobusterResolver:relay.resolver},()=>command('gobuster',['dns'],async line=>{
          for(const item of parseGobuster(line,'dns')){const row=await add(item.kind,item.value,'gobuster',true);if(row?.scopeState==='IN_SCOPE'&&hosts.size<plan.limits.maxHosts){await inventory(String(row.value.hostname));await persistProgramDiscovery(scanRunId,String(row.value.hostname),'GOBUSTER');}}
        },plan.gobuster!.seconds));}catch{dnsFailed=true;}finally{await relay.close();}
      }
      let errors=0;for(const [host,data]of hosts){
      await assertLiveAsset();if(!assetHostAllowed(asset,host,asset.program.outOfScope))continue;
      const resolver=new Resolver({timeout:2500,tries:1});const release=currentScanControl()?.track(async()=>resolver.cancel());
      try{await beforeScanNetwork();const result=await Promise.allSettled([resolver.resolve4(host),resolver.resolve6(host),resolver.resolveCname(host)]);
        for(const r of result.slice(0,2))if(r.status==='fulfilled'&&r.value.length){data.resolved=true;await add('observation',{hostname:host,type:'dns-address',addresses:r.value.slice(0,30)},'dns',true);}
        const cname=result[2];if(cname.status==='fulfilled')for(const value of cname.value.slice(0,10))await add('hostname',{hostname:value,relationship:'CNAME',origin:host},'dns',true);
        if(!data.resolved)errors++;
      }finally{release?.();}
    }if(errors||dnsFailed)throw new Error('PARTIAL: DNS enrichment incomplete; some discovered hosts did not resolve; no network/service scan will be started for them.');});
    const available=[...hosts.entries()].filter(([,h])=>h.resolved).sort((a,b)=>b[1].rank.score-a[1].rank.score||a[0].localeCompare(b[0]));
    const relays=new Map<string,Awaited<ReturnType<typeof createReconRelay>>>(),protections=new Map<string,ReconProtection>();
    const capture=async(host:string,page:ProbeResult)=>{
      const data=hosts.get(host)!;data.pages.set(page.url,page);if(page.error)return;
      await add('endpoint',{url:page.url,method:'GET',statusCode:page.status,contentType:(page.headers['content-type']??'unknown').split(';')[0]},'http',true);
      const auth=page.headers['www-authenticate']??'';const schemes=['basic','bearer','digest','negotiate'].filter(s=>new RegExp(`\\b${s}\\b`,'i').test(auth));
      if(schemes.length)await add('auth-surface',{url:page.url,schemes,type:'http-authentication'},'http',true);
      const indicators=['x-api-key','api-key','x-ratelimit-limit','x-ratelimit-remaining','ratelimit-limit','retry-after'].filter(k=>page.headers[k]);
      if(indicators.length)await add('api-surface',{url:page.url,type:'api-response-headers',headers:indicators},'http',true);
      if(page.headers.location){try{await add('observation',{url:new URL(page.headers.location,page.url).toString(),type:'redirect',origin:safeObservationUrl(page.url)},'http',true);}catch{}}
      if(protections.get(host)?.blocked)activeTool?.abort();
    };
    await stage('HTTP surface',async()=>{let failures=0;for(const [host,data]of available){
      signal.throwIfAborted();const base=asset.format==='URL'?asset.normalizedValue:`https://${host}/`,protection=new ReconProtection(plan.limits.rps,plan.limits.maxRequests);protections.set(host,protection);
      const ctx={...execution,programReconId:undefined,host:new URL(base).host};
      await withTargetExecution(ctx,async()=>{for(const url of asset.format==='URL'?[base]:[base,`http://${host}/`]){
        if(protection.blocked||budget.remaining<=0)break;
        await protection.beforeRequest(signal);budget.remaining--;const {probe}=await import('../scanners/http');const page=await probe(url,{timeoutMs:8000,signal});protection.observe(page.error?undefined:page.status,page.error);await capture(host,page);
        if(!page.error){data.alive=true;data.url??=url;}
      }});
      if(!data.alive){failures++;continue;}
      const chosen=data.url!,chosenContext={...ctx,host:new URL(chosen).host};
      const relay=await createReconRelay(chosenContext,chosen,protection,signal,p=>capture(host,p),budget);relays.set(host,relay);
      try{await withTargetExecution({...chosenContext,reconRelayOrigin:relay.origin,reconRelayTarget:chosen},()=>command('httpx',['-u',relay.toRelay(chosen)],async line=>{try{const r=JSON.parse(line);if(typeof r.url==='string')r.url=relay.mapUrl(r.url);await rows(parseHttpx(JSON.stringify(r)),'httpx');}catch{}},20));}catch{throwIfScanAborted();failures++;}
    }if(failures)throw new Error('PARTIAL: Some HTTP services/tools were unavailable; observed responses retained.');});
    await stage('Host prioritization',async()=>{for(const [host,data]of hosts){const content=[...data.pages.values()].map(p=>p.body.slice(0,20000)).join(' ');data.rank=rankReconHost(host,{alive:data.alive,auth:/password|login|sign in|bearer/i.test(content),api:/openapi|swagger|graphql|\/api\//i.test(content),admin:/admin|dashboard/i.test(content)});if(data.resolved||data.alive)await add('observation',{hostname:host,type:'recon-budget-ranking',score:data.rank.score,signals:data.rank.signals},'planner');}});
    const selected=[...hosts.entries()].filter(([,h])=>h.alive).sort((a,b)=>b[1].rank.score-a[1].rank.score||a[0].localeCompare(b[0])).slice(0,plan.limits.enrichHosts);
    if([...hosts.values()].filter(h=>h.alive).length>selected.length)bounded=true;
    await stage('Ports / services',async()=>{let failures=0;for(const [host,data]of [...hosts].filter(([,h])=>h.resolved).sort((a,b)=>b[1].rank.score-a[1].rank.score||a[0].localeCompare(b[0])).slice(0,plan.limits.enrichHosts)){
      let xml='';try{await withTargetExecution({...execution,programReconId:undefined,host},()=>command('nmap',[host],async line=>{if(xml.length<2*1024*1024)xml+=line+'\n';},50));await rows(parseNmap(xml,host),'nmap');}catch{failures++;}void data;
    }if(failures)throw new Error('PARTIAL: Some bounded Nmap executions failed.');});
    const eachWeb=async(work:(host:string,data:typeof hosts extends Map<string,infer D>?D:never,relay:Awaited<ReturnType<typeof createReconRelay>>)=>Promise<void>)=>{
      let failures=0,blocked=false;for(const [host,data]of selected){const relay=relays.get(host)!;const protection=protections.get(host)!;
        if(protection.blocked){blocked=true;continue;}
        try{const base=data.url!;await withTargetExecution({...execution,programReconId:undefined,host:new URL(base).host,reconRelayOrigin:relay.origin,reconRelayTarget:base},()=>work(host,data,relay));if(protection.blocked)blocked=true;}catch{throwIfScanAborted();failures++;blocked||=protection.blocked;}
      }if(blocked)throw new Error('BLOCKED: Remote rate limiting / repeated errors; remaining active requests stopped.');if(failures)throw new Error('PARTIAL: Some selected hosts or scanner steps were incomplete.');
    };
    await stage('Web / API mapping',()=>eachWeb(async(host,data,relay)=>{
      const base=data.url!,queue=[base,...(asset.type==='API'?['openapi.json','swagger.json','api-docs','graphql','v1','v2'].map(p=>new URL(p,base.endsWith('/')?base:base+'/').toString()):[])],visited=new Set<string>();const pages:ProbeResult[]=[];
      while(queue.length&&visited.size<plan.limits.crawlPages){const url=queue.shift()!;if(visited.has(url)||!assetAllowsUrl(asset,url)||!isSafeReadUrl(url))continue;visited.add(url);
        const page=data.pages.get(url)??await relay.request(url);if(page.error)continue;pages.push(page);
        const references=[...page.body.matchAll(/(?:href|src|action)\s*=\s*["']([^"'<>]{1,2048})|(?:fetch|url)\s*\(?\s*[:=]?\s*["']([^"'<>]{1,2048})/gi)].map(m=>m[1]??m[2]);
        if(/json/i.test(page.headers['content-type']??''))try{const spec=JSON.parse(page.body);if((spec.openapi||spec.swagger)&&spec.paths)references.push(...Object.keys(spec.paths).slice(0,100));}catch{}
        for(const ref of references)try{const found=new URL(ref,page.url).toString();await add('endpoint',{url:found},'crawler');if(assetAllowsUrl(asset,found)&&isSafeReadUrl(found)&&queue.length<100)queue.push(found);}catch{}
      }
      const corpus=analyzeCorpus({html:pages.map(p=>p.body).join('\n'),urls:[...visited],pages,authenticated:false},base);
      for(const form of corpus.forms){await add('endpoint',{url:form.url,declaredMethod:form.method},'corpus');for(const name of form.fields)await add('parameter',{url:form.url,name},'corpus');}
      for(const p of corpus.queryInputs)await add('parameter',{url:p.url,name:p.key},'corpus');
      for(const name of corpus.technologies)await add('technology',{hostname:host,name},'corpus');
      for(const url of corpus.authUrls)await add('auth-surface',{url,type:'auth-route'},'corpus');
      for(const url of corpus.apiUrls)await add('api-surface',{url,type:'api-route'},'corpus');
      if(new URL(base).protocol==='https:'){await beforeScanNetwork();await new Promise<void>(resolve=>{const socket=connect({host,port:Number(new URL(base).port||443),servername:host});const release=currentScanControl()?.track(async()=>{socket.destroy();});let done=false;const finish=()=>{if(done)return;done=true;socket.destroy();release?.();resolve();};socket.setTimeout(3000,finish);socket.on('error',finish);socket.on('close',finish);socket.on('secureConnect',()=>{const cert=socket.getPeerCertificate();void add('tls',{hostname:host,type:'tls-certificate',fingerprint:cert.fingerprint256??'unknown',validFrom:cert.valid_from??'unknown',validTo:cert.valid_to??'unknown'},'tls',true).finally(finish);});});}
    }),!selected.length?'No validated HTTP service; no web content requests.':undefined);
    await stage('Content discovery',()=>eachWeb(async(_host,data,relay)=>{
      const words=(await readFile(join(process.cwd(),'src/server/recon/wordlists',asset.type==='API'?'api.txt':'web.txt'),'utf8')).split(/\r?\n/).filter(Boolean).slice(0,plan.limits.words);
      // LIGHT uses one engine; STANDARD/DEEP partition words to avoid duplicate requests.
      const gobusterWords=plan.gobuster?.dir ? (plan.depth==='LIGHT'?words:words.splice(-plan.gobuster.words)) : [];
      let gobusterFailed=false;
      if(gobusterWords.length){const gp=join(temp,'gobuster-dir.txt');await writeFile(gp,gobusterWords.join('\n')+'\n',{mode:0o600});
        try{await withTargetExecution({...currentTargetExecution(),gobusterWordlist:gp},()=>command('gobuster',['dir','-u',relay.toRelay(data.url!.endsWith('/')?data.url!:data.url!+'/'),'-w',gp],async line=>{
          for(const item of parseGobuster(line,'dir'))try{item.value.url=relay.mapUrl(String(item.value.url));await rows([item],'gobuster');}catch{}
        },plan.gobuster!.seconds));}catch{gobusterFailed=true;}
      }
      const path=join(temp,'profile.txt');await writeFile(path,words.join('\n')+'\n',{mode:0o600});
      const queue=[data.url!.endsWith('/')?data.url!:data.url!+'/'],visited=new Set<string>();
      for(let depth=0;!(plan.gobuster?.dir&&plan.depth==='LIGHT')&&depth<=plan.limits.ffufDepth&&queue.length;depth++){
        const next:string[]=[];for(const base of queue.splice(0,Math.max(1,plan.limits.ffufDepth))){if(visited.has(base))continue;visited.add(base);if(!assetAllowsUrl(asset,base))continue;
          await withTargetExecution({...currentTargetExecution(),ffufWordlist:path},()=>command('ffuf',['-u',relay.toRelay(base)+'FUZZ','-w',path],async line=>{for(const item of parseFfuf(line)){try{item.value.url=relay.mapUrl(String(item.value.url));await rows([item],'ffuf');if(String(item.value.url).endsWith('/')&&Number(item.value.statusCode)<400)next.push(String(item.value.url));}catch{}}},plan.limits.ffufSeconds+2));
        }queue.push(...next.slice(0,plan.limits.ffufDepth));
      }
      if(gobusterFailed)throw new Error('PARTIAL: Gobuster discovery incomplete; other evidence retained.');
    }),!selected.length?'No validated HTTP service.':undefined);
    await stage('Nuclei Recon',()=>eachWeb(async(_host,data,relay)=>{
      await command('nuclei',['-u',relay.toRelay(data.url!)],async line=>{try{const r=JSON.parse(line);if(typeof r['matched-at']==='string')r['matched-at']=relay.mapUrl(r['matched-at']);await rows(parseNuclei(JSON.stringify(r),RECON_TEMPLATE_IDS.slice(0,plan.limits.templates),RECON_TEMPLATE_VERSION),'nuclei');}catch{}},Math.min(90,plan.limits.ffufSeconds+15));
    }),!selected.length?'No validated HTTP service.':undefined);
    await stage('Burp enrichment',async()=>{const {collectRunBurp}=await import('./burpCollection');const result=await collectRunBurp(scanRunId,signal);toolchain.burp={available:result.status==='AVAILABLE',version:result.version??'unknown',capable:result.status==='AVAILABLE',...(result.status!=='AVAILABLE'?{reason:'Authorized history collection unavailable'}:{})};await prisma.scanRun.update({where:{id:scanRunId},data:{toolVersions:toolchain as unknown as Prisma.InputJsonValue}});for(const item of result.observations)await add('observation',item,'burp',true);if(result.status!=='AVAILABLE')throw new Error('PARTIAL: Burp history unavailable; no active requests or provider started.');},!selected.length?'No validated web service for authorized Burp history correlation.':undefined);
    await stage('Normalization',async()=>{const all=await prisma.reconArtifact.findMany({where:{scanRunId},select:artifactSelect});const previous=await prisma.scanRun.findFirst({where:{scopeAssetId:asset.id,id:{not:scanRunId},status:'COMPLETED',outcome:'SUCCESS'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
      const old=previous?await prisma.reconArtifact.findMany({where:{scanRunId:previous.id},select:artifactSelect}):[];
      const diff=reconDiff(all.map(artifactData),old.map(artifactData),Boolean(previous));await prisma.scanRun.update({where:{id:scanRunId},data:{artifactVersion:2,changeSet:{...diff,previousScanId:previous?.id??null} as unknown as Prisma.InputJsonValue}});
      if(bounded)throw new Error('PARTIAL: Host enrichment bound reached; complete discovery inventory retained as artifacts.');
    });
    await stage('Scope intelligence',async()=>{});
    await Promise.all([...relays.values()].map(r=>r.close()));
  });}catch(e){throwIfScanAborted();incomplete=true;await prisma.scanRun.update({where:{id:scanRunId},data:{error:timeout.aborted?'Recon duration budget exhausted':'Recon interrupted; available artifacts retained',artifactVersion:2}});void e;}
  finally{await rm(temp,{recursive:true,force:true});await prisma.reconPipelineStep.updateMany({where:{scanRunId,state:{in:['PENDING','RUNNING']}},data:{state:'SKIPPED',reason:'Execution ended before this stage completed.',finishedAt:new Date()}});}
  const count=await prisma.reconArtifact.count({where:{scanRunId}});
  return incomplete||bounded?{outcome:count?'PARTIAL':'FAILED',reason:'Incomplete, blocked, missing-tool or bounded stages; inspect Scope coverage.'}:{outcome:'SUCCESS'};
}
