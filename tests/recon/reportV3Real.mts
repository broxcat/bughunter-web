// Real model + exact historical Recon evidence, exclusively in a disposable DB.
// No scanner/worker runs here. No prompt, model body or evidence is logged.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { chmod, chown, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright-chromium';
import { Prisma, type AiProvider, type ReconArtifact, type ReconSummary, type ScanRun, type ScopeAsset, type ReconPipelineStep } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { scheduleReconSummary, processReconSummary } from '@/server/recon/summaries';
import { classifyReconUrl } from '@/lib/reconArtifacts';
import { modelInputForReconReportV3, type ReconReportV3Input } from '@/lib/reconReportV3';
import { presentReconFacts, reconSynthesisPresentation } from '@/lib/reconFactPresentation';
import type { ReconReportV3 } from '@/lib/reconReportV3';

type Json = Record<string, unknown>;
type Serialized<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
type Source = { config: { model: string; baseUrl: string }; scan: Serialized<ScanRun> & { target: { userId: string; programId: string }; scopeAsset: Serialized<ScopeAsset>; reconSteps: Serialized<ReconPipelineStep>[] }; job: Serialized<ReconSummary>; artifacts: Serialized<ReconArtifact>[];targetReport?:Serialized<ReconSummary> };
type Saved = { sourceSha256: string; asset: Serialized<ReconSummary>; target: Serialized<ReconSummary>; sequence?: Serialized<ReconSummary>[] };
type CapturedConfig={provider:AiProvider;model:string;baseUrl:string;apiKeyCipher?:string|null;isActive?:boolean};
const json = (v: unknown) => v as Prisma.InputJsonValue;
const nullableJson = (v: unknown) => v === null || v === undefined ? Prisma.DbNull : json(v);
const date = (v: string | null | undefined) => v ? new Date(v) : null;
const asObject = (v: unknown): Json => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const serial = <T,>(v: T): Serialized<T> => JSON.parse(JSON.stringify(v)) as Serialized<T>;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const citedRefs = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(citedRefs) : v && typeof v === 'object' ? Object.entries(v).flatMap(([key, item]) => key === 'evidenceRefs' && Array.isArray(item) ? item.filter((ref): ref is string => typeof ref === 'string') : citedRefs(item)) : [];
function safeProviderRejection(raw:string){
  const vocabulary=new Set(['invalid','json','schema','unknown','unsupported','unrecognized','unexpected','field','fields','property','properties','additionalproperties','required','missing','type','value','array','object','string','integer','boolean','null','not','allowed','supported','permitted','must','be','empty','minimum','maximum','depth','recursive','recursion','reference','references','format','uri','url','date-time','uuid','$defs','$ref','$schema','defs','ref','anyof','oneof','allof','enum','items','minitems','maxitems','minlength','maxlength','pattern','additional_properties','max_tokens','max_output_tokens','max_completion_tokens','temperature','reasoning','thinking','response_format','json_schema','strict','budget','tokens','input','output','tool','tools','function','functions','parameters','provider','returned','error','in','at','for','of','does','cannot','exceed','greater','less','than','omit','supported_parameters']);
  const knownTerms=(raw.match(/\$?[A-Za-z_][A-Za-z0-9_-]*/g)??[]).map(t=>t.toLowerCase()).filter(t=>vocabulary.has(t)).slice(0,100);
  const flags={schema:/schema|\$ref|\$defs|additionalProperties/i.test(raw),unsupported:/unsupported|not supported|unknown|unrecognized/i.test(raw),tokenBudget:/max[_ ]?(?:output[_ ]?|completion[_ ]?)?tokens|token.*budget/i.test(raw),invalidArgument:/INVALID_ARGUMENT/i.test(raw),routeUnavailable:/no endpoints|model_not_found/i.test(raw),upstreamApiKeyInvalid:/API_KEY_INVALID|api.?key[\s\S]{0,100}(?:not valid|invalid)/i.test(raw),upstreamApiKeyExpired:/API_KEY_EXPIRED|api.?key[\s\S]{0,100}expired/i.test(raw),serviceAccount:/service.?account/i.test(raw),projectPermission:/project[\s\S]{0,100}(?:permission|denied|disabled)|PERMISSION_DENIED/i.test(raw),requestPayloadInvalid:/request[\s\S]{0,40}(?:payload|contains)[\s\S]{0,40}invalid/i.test(raw),parameterInvalid:/(?:parameter|argument)[\s\S]{0,40}invalid|invalid[\s\S]{0,40}parameter/i.test(raw),contentInvalid:/content[\s\S]{0,40}invalid|invalid[\s\S]{0,40}content/i.test(raw),modelNotFound:/(?:model|entity)[\s\S]{0,100}(?:not found|does not exist)/i.test(raw),locationUnsupported:/(?:region|location|country)[\s\S]{0,100}(?:unsupported|not supported|denied)/i.test(raw),reasoning:/reasoning|thinking/i.test(raw)};
  const parsed=(()=>{try{return JSON.parse(raw) as Json;}catch{return{};}})(),error=asObject(parsed.error);
  const publicCode=typeof error.code==='number'?error.code:typeof error.code==='string'&&['INVALID_ARGUMENT','invalid_request_error','invalid_json_schema','validation_error','provider_error'].includes(error.code)?error.code:undefined;
  return{publicCode,flags,knownTerms};
}
const metadata = (phase: string, extra: Json = {}) => console.log(JSON.stringify({ acceptance: 'recon-report-v3', phase, ...extra }));
async function savePrivate(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await protectArtifact(path);
}
async function protectArtifact(path:string){
  await chmod(path,0o600);
  const uid = Number(process.env.RECON_REPORT_V3_OUTPUT_UID), gid = Number(process.env.RECON_REPORT_V3_OUTPUT_GID);
  // The image runs as root; the host must retain access to its private export
  // after this disposable container is removed. Keep mode0600 throughout.
  if (process.getuid?.() === 0 && Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) await chown(path, uid, gid);
}
let phase = 'preflight', browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, web: ReturnType<typeof spawn> | undefined;

async function main() {
  assert.equal(process.env.BH_DISPOSABLE_REPORT_V3, '1', 'Disposable acceptance marker required');
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/report_v3_real_test', 'Disposable database required');
  const raw = await readFile(process.env.RECON_REPORT_V3_SOURCE_FILE!, 'utf8'), source = JSON.parse(raw) as Source;
  const sourceSha256 = createHash('sha256').update(raw).digest('hex');
  const scan = source.scan, asset = scan.scopeAsset, ownerId = scan.target.userId, programId = scan.target.programId;
  assert(scan.id && asset.id && ownerId && programId && source.artifacts.length, 'Incomplete exported Recon');
  assert(source.config.model && source.config.baseUrl, 'Selected Settings missing');
  assert.equal(await prisma.user.count(), 0, 'Acceptance database must be empty');
  const routing=process.env.RECON_REPORT_MULTI_PROVIDER==='1';
  const factsRender=process.env.RECON_FACTS_RENDER_ACCEPTANCE==='1';
  const requireNarrative=process.env.RECON_REQUIRE_NARRATIVE==='1',requireTargetNarrative=process.env.RECON_REQUIRE_TARGET_NARRATIVE==='1',assetBaselineFile=process.env.RECON_FACTS_ASSET_BASELINE_FILE;
  const configs:CapturedConfig[]=routing?(JSON.parse(await readFile(process.env.RECON_ROUTING_CONFIGS_FILE!,'utf8')) as {configs:CapturedConfig[]}).configs:[{provider:'OLLAMA',model:source.config.model,baseUrl:source.config.baseUrl}];
  const selected=(provider:AiProvider)=>{const c=configs.find(c=>c.provider===provider);assert(c?.model&&c.baseUrl,'Selected provider Settings missing');return c;};
  if(routing)assert(selected('OPENROUTER').apiKeyCipher,'Encrypted OpenRouter credentials missing');

  const provider = new URL(source.config.baseUrl), allowedOrigins = new Set(configs.map(c=>new URL(c.baseUrl).origin));
  const originalFetch = globalThis.fetch;
  let providerRequests = 0,openRouterRequests=0,paidReportRequests=0;const providerHttpStatuses:number[]=[];
  globalThis.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    assert(allowedOrigins.has(u.origin), 'Report attempted an unapproved network origin');
    if (u.origin === provider.origin) providerRequests++;
    const router=routing?selected('OPENROUTER'):undefined;
    if(router&&u.origin===new URL(router.baseUrl).origin&&u.pathname.endsWith('/chat/completions')){
      const body=JSON.parse(String(init?.body)) as Json;
      assert.equal(body.model,router.model,'OpenRouter request changed the configured model');
      assert.equal(asObject(body.response_format).type,'json_schema','OpenRouter structured output was not requested');
      assert.equal(asObject(asObject(body.response_format).json_schema).strict,true,'OpenRouter schema must be strict');
      assert.equal(asObject(body.provider).require_parameters,true,'OpenRouter must require structured-output support');
      assert(!Object.hasOwn(body,'format')&&!Object.hasOwn(body,'think'),'Ollama parameters leaked into OpenRouter request');
      assert(new Headers(init?.headers).has('authorization'),'Configured provider credential was not attached in the backend');
      assert(paidReportRequests<(factsRender&&!requireNarrative?1:2),'Paid report would exceed its explicit request limit');paidReportRequests++;openRouterRequests++;
    }
    const response=await originalFetch(input, { ...init, redirect: 'error' });
    if(router&&u.origin===new URL(router.baseUrl).origin&&u.pathname.endsWith('/chat/completions'))providerHttpStatuses.push(response.status);
    if(router&&u.origin===new URL(router.baseUrl).origin&&u.pathname.endsWith('/chat/completions')&&!response.ok){
      const reader=response.clone().body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
      if(reader)try{while(bytes<16384){const part=await reader.read();if(part.done)break;const chunk=part.value.subarray(0,16384-bytes);bytes+=chunk.length;chunks.push(chunk);}}finally{await reader.cancel().catch(()=>{});}
      // Only dictionary tokens and booleans escape this in-memory error probe.
      // Upstream bodies, target strings and supplied schemas are never emitted.
      metadata('openrouter-http-diagnostic',{httpStatus:response.status,...safeProviderRejection(Buffer.concat(chunks).toString('utf8'))});
    }
    return response;
  };
  try {
    phase = 'clone';
    const password = randomUUID(), email = randomUUID() + '@example.test';
    await prisma.user.create({ data: { id: ownerId, email, passwordHash: await bcrypt.hash(password, 10) } });
    const originalMetadata = asObject(asObject(source.job.input).metadata);
    await prisma.bountyProgram.create({ data: { id: programId, ownerId, companyName: typeof originalMetadata.target === 'string' ? originalMetadata.target : 'Copied Recon acceptance', requiredUserAgent: scan.requiredUserAgent ?? 'Report-Acceptance/3', scopeRules: [asset.normalizedValue], outOfScope: Array.isArray(originalMetadata.exclusions) ? originalMetadata.exclusions.filter((x): x is string => typeof x === 'string') : [], rulesOfEngagement: typeof originalMetadata.rulesOfEngagement === 'string' ? originalMetadata.rulesOfEngagement : null } });
    await prisma.scopeAsset.create({ data: { ...asset, createdAt: new Date(asset.createdAt), updatedAt: new Date(asset.updatedAt) } });
    const url = new URL(/^https?:\/\//i.test(asset.normalizedValue) ? asset.normalizedValue : 'https://' + asset.normalizedValue.replace(/^\*\./, ''));
    const scope = await prisma.scope.create({ data: { userId: ownerId, hostPattern: asset.normalizedValue, status: 'APPROVED' } });
    await prisma.target.create({ data: { id: scan.targetId, userId: ownerId, programId, scopeId: scope.id, scopeAssetId: asset.id, host: url.host, scheme: url.protocol.slice(0, -1), active: false } });
    const parentId = scan.targetReconRunId ?? 'acceptance-' + randomUUID();
    await prisma.targetReconRun.create({ data: { id: parentId, programId, status: scan.status, outcome: scan.outcome, createdAt: new Date(scan.createdAt), startedAt: date(scan.startedAt), finishedAt: date(scan.finishedAt) } });
    const { target: _target, scopeAsset: _asset, reconSteps, ...scanData } = scan;
    void _target; void _asset;
    await prisma.scanRun.create({ data: { ...scanData, targetReconRunId: parentId, createdAt: new Date(scan.createdAt), startedAt: date(scan.startedAt), finishedAt: date(scan.finishedAt), cancelRequestedAt: date(scan.cancelRequestedAt), ...Object.fromEntries(['reconPlan','toolVersions','toolManifest','changeSet','scopeAssetSnapshot','assetResults','huntReport','reconCorpus','huntSnapshot'].map(key => [key, nullableJson(scanData[key as keyof typeof scanData])])) } as Prisma.ScanRunUncheckedCreateInput });
    await prisma.reconPipelineStep.createMany({ data: reconSteps.map(row => ({ ...row, details: nullableJson(row.details), startedAt: date(row.startedAt), finishedAt: date(row.finishedAt) })) });
    await prisma.reconArtifact.createMany({ data: source.artifacts.map(row => ({ ...row, value: json(row.value), sources: json(row.sources), firstSeenAt: new Date(row.firstSeenAt), lastSeenAt: new Date(row.lastSeenAt) })) });
    for(const config of configs)await prisma.aiProviderConfig.create({data:{userId:ownerId,provider:config.provider,baseUrl:config.baseUrl,model:config.model,apiKeyCipher:config.apiKeyCipher,isActive:factsRender?!!config.isActive:config.provider==='OLLAMA'}});
    const setDefault=async(provider:AiProvider)=>{await prisma.$transaction(async tx=>{await tx.aiProviderConfig.updateMany({where:{userId:ownerId},data:{isActive:false}});await tx.aiProviderConfig.update({where:{userId_provider:{userId:ownerId,provider}},data:{isActive:true}});});};
    const historical = await prisma.reconSummary.create({ data: { ...source.job, input: json(source.job.input), content: nullableJson(source.job.content), createdAt: new Date(source.job.createdAt), startedAt: date(source.job.startedAt), generatedAt: date(source.job.generatedAt) } });
    const historicalHash = digest(serial(historical));
    const evidenceBefore = digest(await prisma.reconArtifact.findMany({ orderBy: { id: 'asc' } }));
    const scanBefore = digest(await prisma.scanRun.findUniqueOrThrow({ where: { id: scan.id } }));

    const replayFile = process.env.RECON_REPORT_V3_REPLAY_FILE;
    const sequence:ReconSummary[]=[];let expectedProvider:AiProvider=factsRender?'OPENROUTER':'OLLAMA';
    let assetReport: ReconSummary, targetReport: ReconSummary;
    if (replayFile) {
      phase = 'replay';
      const saved = JSON.parse(await readFile(replayFile, 'utf8')) as Saved;
      assert.equal(saved.sourceSha256, sourceSha256, 'Saved reports belong to another Recon export');
      const restore = async(row: Serialized<ReconSummary>) => {const exists=await prisma.reconSummary.findUnique({where:{id:row.id}});if(exists){assert.deepEqual(exists.content,row.content);return exists;}return prisma.reconSummary.create({ data: { ...row, automaticKey: null, input: json(row.input), content: nullableJson(row.content), createdAt: new Date(row.createdAt), startedAt: date(row.startedAt), generatedAt: date(row.generatedAt) } });};
      assetReport = await restore(saved.asset); targetReport = await restore(saved.target);
      for(const row of saved.sequence??[])if(![saved.asset.id,saved.target.id].includes(row.id))sequence.push(await restore(row));
      metadata('replay', { status: 'PASS', realModelGenerationPreviouslySaved: true });
    } else {
      const generate = async (assetId?: string) => {
        phase = (assetId ? 'asset-generation-' : 'target-generation-')+expectedProvider;
        const config=selected(expectedProvider),beforeRequests=openRouterRequests;
        paidReportRequests=0;
        const started = Date.now(), job = await scheduleReconSummary(ownerId, programId, assetId, true);
        assert.equal(job.promptVersion, 'recon-report/3', 'New reports must use prompt v3');
        assert.equal(job.provider,expectedProvider);assert.equal(job.model,config.model);assert.equal(job.endpoint.replace(/\/+$/, ''),config.baseUrl.replace(/\/+$/, ''));
        assert.equal(asObject(job.input).version, 3);
        if(config.apiKeyCipher)assert(!JSON.stringify(job.input).includes(config.apiKeyCipher),'Encrypted credentials leaked into report evidence');
        await processReconSummary(job.id);
        const saved = await prisma.reconSummary.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(saved.status, 'READY', 'Real report did not become READY');
        const report = asObject(saved.content), input = asObject(saved.input);
        const generation = asObject(report.generation), budget = asObject(input.budget);
        const warningPaths = (Array.isArray(report.warnings) ? report.warnings : []).map(item => ({ code: asObject(item).code, path: asObject(item).path })).filter(item => typeof item.code === 'string' && /^[A-Z_]+$/.test(item.code) && typeof item.path === 'string' && /^[A-Za-z0-9_.[\]]{1,160}$/.test(item.path));
        metadata(phase + '-result', { status: saved.status,provider:saved.provider, model: saved.model, promptVersion: saved.promptVersion, narrativeStatus: report.narrativeStatus, narrativeFailure: report.narrativeFailure ?? null, warningPaths, httpStatuses:providerHttpStatuses.slice(beforeRequests), attempts: (Array.isArray(generation.attempts) ? generation.attempts : []).map(item => ({ attempt: asObject(item).attempt, status: asObject(item).status,httpStatus:asObject(item).httpStatus,providerErrorCode:asObject(item).providerErrorCode,finishReason:asObject(item).finishReason })),openRouterRequests, latencyMs: Date.now() - started, generationMs: generation.durationMs, contextTokens: budget.contextTokens, maxInputBytes: budget.maxInputBytes, outputTokens: budget.outputTokens, modelInputBytes: Buffer.byteLength(JSON.stringify(modelInputForReconReportV3(saved.input as unknown as ReconReportV3Input))) });
        if (report.narrativeStatus === 'FACTUAL_ONLY' && process.env.RECON_REPORT_V3_OUTPUT_FILE) await savePrivate(process.env.RECON_REPORT_V3_OUTPUT_FILE + '.failed.json', { sourceSha256, phase, report: serial(saved) });
        assert.equal(report.version, 3); assert.deepEqual(report.factual, input.factual, 'Model changed server-owned facts');
        const ledger = Array.isArray(input.fullEvidenceLedger) ? input.fullEvidenceLedger : [];
        const knownIds = new Set(ledger.map(row => asObject(row).id));
        assert(knownIds.size > 0, 'Factual evidence ledger missing');
        const references = citedRefs(report.narrative);
        const acceptedFactualOnly=process.env.RECON_ROUTING_ALLOW_FACTUAL_ONLY==='1'&&expectedProvider==='OPENROUTER'&&report.narrativeStatus==='FACTUAL_ONLY';
        if(!acceptedFactualOnly)assert(references.length > 0, 'Real model supplied no cited interpretation');
        for (const id of references) assert(knownIds.has(id), 'Stored model citation is not a real retained evidence reference');
        for (const artifact of source.artifacts) {
          const url = asObject(artifact.value).url;
          let isStatic = false;
          if (typeof url === 'string') try { isStatic = classifyReconUrl(url) === 'static'; } catch { /* Malformed source remains documentary. */ }
          assert(isStatic || knownIds.has(artifact.id), 'Non-static source evidence disappeared from the factual ledger');
        }
        assert(acceptedFactualOnly||['VALID','RECOVERED'].includes(String(report.narrativeStatus)), 'Factual-only fallback is not real-model acceptance');
        assert(JSON.stringify(report.narrative).length > 100, 'Real model narrative missing');
        assert(openRouterRequests-beforeRequests<=2,'Paid report exceeded two attempts');
        if(expectedProvider==='OPENROUTER')assert(openRouterRequests>beforeRequests,'No real OpenRouter request was sent');
        metadata(phase, { status: 'PASS', model: saved.model, promptVersion: saved.promptVersion, latencyMs: Date.now() - started, narrativeStatus: report.narrativeStatus,realNarrativeValidated:!acceptedFactualOnly, warningCount: Array.isArray(report.warnings) ? report.warnings.length : 0, citationCount: references.length, artifacts: source.artifacts.length, storedSnapshotBytes: Buffer.byteLength(JSON.stringify(input)) });
        return saved;
      };
      if(factsRender){
        assert(selected('OPENROUTER').isActive,'Current Settings must select OpenRouter for this acceptance');
        if(assetBaselineFile){const saved=JSON.parse(await readFile(assetBaselineFile,'utf8')) as Saved;assert.equal(saved.sourceSha256,sourceSha256);const row=saved.asset;assert.equal(row.provider,'OPENROUTER');assert(['VALID','RECOVERED'].includes(String(asObject(row.content).narrativeStatus)));assetReport=await prisma.reconSummary.create({data:{...row,automaticKey:null,input:json(row.input),content:nullableJson(row.content),createdAt:new Date(row.createdAt),startedAt:date(row.startedAt),generatedAt:date(row.generatedAt)}});metadata('real-asset-baseline',{status:'PASS',reusedPreviouslyValidatedRealInference:true});}else assetReport=await generate(asset.id);sequence.push(assetReport);
        const target=source.targetReport;assert(target,'A real captured Target report is required for rendering acceptance');
        assert.equal(target.targetReconRunId,parentId,'Target fixture belongs to a different captured Recon parent');
        targetReport=requireTargetNarrative?await generate():await prisma.reconSummary.create({data:{...target,automaticKey:null,input:json(target.input),content:nullableJson(target.content),createdAt:new Date(target.createdAt),startedAt:date(target.startedAt),generatedAt:date(target.generatedAt)}});
        assert(openRouterRequests<=(requireTargetNarrative?(assetBaselineFile?2:4):requireNarrative?2:1),'Real OpenRouter request budget exceeded');
        if(requireNarrative)assert(['VALID','RECOVERED'].includes(String(asObject(assetReport.content).narrativeStatus)),'AI narrative is a release blocker');if(requireTargetNarrative)assert(['VALID','RECOVERED'].includes(String(asObject(targetReport.content).narrativeStatus)),'Target AI narrative is a release blocker');
        metadata('facts-render-provider',{status:'PASS',requests:openRouterRequests,routingChanged:false,modelChanged:false});
      }else{
      const routerOnly=process.env.RECON_ROUTING_ROUTER_ONLY==='1';
      const baseline=routerOnly?JSON.parse(await readFile(process.env.RECON_ROUTING_BASELINE_FILE!,'utf8')) as Saved:undefined;
      const restoreBaseline=async(row:Serialized<ReconSummary>)=>prisma.reconSummary.create({data:{...row,provider:'OLLAMA',automaticKey:null,input:json(row.input),content:nullableJson(row.content),createdAt:new Date(row.createdAt),startedAt:date(row.startedAt),generatedAt:date(row.generatedAt)}});
      if(baseline){assert.equal(baseline.sourceSha256,sourceSha256);assetReport=await restoreBaseline(baseline.asset);metadata('real-ollama-baseline',{status:'PASS',reusedPreviouslyValidatedRealInference:true});}else assetReport = await generate(asset.id);sequence.push(assetReport);
      if(routing){
        expectedProvider='OPENROUTER';await setDefault(expectedProvider);
        const config=selected(expectedProvider),response=await fetch(config.baseUrl.replace(/\/+$/,'')+'/models',{signal:AbortSignal.timeout(10000)});
        if(response.ok){const catalog=await response.json() as {data?:{id:string;supported_parameters?:string[]}[]};const model=catalog.data?.find(m=>m.id===config.model);assert(model,'Configured OpenRouter model is absent from its current catalog');if(model.supported_parameters)assert(model.supported_parameters.includes('response_format')||model.supported_parameters.includes('structured_outputs'),'Configured OpenRouter model does not advertise structured output');metadata('openrouter-preflight',{status:'PASS',model:config.model,structuredOutputAdvertised:!!model.supported_parameters});}else{await response.body?.cancel();metadata('openrouter-preflight',{status:'SKIPPED',httpStatus:response.status});}
        const routed=await generate(asset.id);sequence.push(routed);
        if(baseline){targetReport=await restoreBaseline(baseline.target);sequence.push(targetReport);expectedProvider='OLLAMA';await setDefault(expectedProvider);assetReport=routed;}
        else{targetReport=await generate();sequence.push(targetReport);expectedProvider='OLLAMA';await setDefault(expectedProvider);assetReport=await generate(asset.id);sequence.push(assetReport);}
        assert.deepEqual(asObject(sequence[0].content).factual,asObject(sequence[1].content).factual,'Provider switch changed server facts');assert.deepEqual(asObject(sequence[0].content).factual,asObject(assetReport.content).factual,'Switching back changed server facts');
        for(const row of sequence)assert.deepEqual(await prisma.reconSummary.findUniqueOrThrow({where:{id:row.id}}),row,'Provider switch rewrote a previous report');
        metadata('routing-history',{status:'PASS',defaultSequence:['OLLAMA','OPENROUTER','OLLAMA'],assetProviders:sequence.filter(r=>r.scopeAssetId).map(r=>r.provider),reusedRealOllamaBaseline:!!baseline,reportsPreserved:sequence.length,openRouterRequests,structuredOutputRequired:true});
      }else targetReport = await generate();
      }
      assert(providerRequests > 0 || routing&&openRouterRequests>0, 'No request reached a configured real provider');
      if (process.env.RECON_REPORT_V3_OUTPUT_FILE) await savePrivate(process.env.RECON_REPORT_V3_OUTPUT_FILE, { sourceSha256, asset: serial(assetReport), target: serial(targetReport),sequence:sequence.map(serial) });
    }

    phase = 'source-preservation';
    assert.equal(digest(serial(await prisma.reconSummary.findUniqueOrThrow({ where: { id: historical.id } }))), historicalHash, 'Historical v2 summary mutated');
    assert.equal(digest(await prisma.reconArtifact.findMany({ orderBy: { id: 'asc' } })), evidenceBefore, 'Original evidence mutated');
    assert.equal(digest(await prisma.scanRun.findUniqueOrThrow({ where: { id: scan.id } })), scanBefore, 'Original Recon mutated');
    assert.equal(await prisma.scanExecutionAttempt.count(), 0, 'Reports must never start scanners');
    assert.equal(await prisma.scanJobOutbox.count(), 0, 'Reports must never queue scanners');
    metadata(phase, { status: 'PASS', historicalSummaryUnchanged: true, originalReconUnchanged: true, scannerAttempts: 0, queuedScannerJobs: 0 });

    if (process.env.RECON_REPORT_V3_BROWSER === 'true') {
      phase = 'browser';
      const socket = createServer(); await new Promise<void>(r => socket.listen(0, '127.0.0.1', r));
      const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()));
      const origin = `http://127.0.0.1:${port}`; allowedOrigins.add(origin);
      web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: process.cwd(), env: { ...process.env, AUTH_URL: origin, AUTH_SECRET: randomUUID(), ALLOW_PUBLIC_REGISTRATION: 'false', TRUST_PROXY_HEADERS: 'false' }, stdio: 'ignore' });
      for (let n = 0;; n++) {
        assert(web.exitCode === null, 'Isolated web stopped');
        try { if ((await fetch(origin + '/api/health')).ok) break; } catch { /* Readiness only. */ }
        assert(n < 150, 'Isolated web readiness timeout'); await new Promise(r => setTimeout(r, 100));
      }
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const context = await browser.newContext();
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(), pageErrors: string[] = [];
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await page.goto(origin + '/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(origin + '/targets');
      for (const [path, api, saved] of [
        ['/scopes/' + asset.id, `/api/programs/${programId}/assets/${asset.id}/summary`, assetReport],
        ['/targets/' + programId, `/api/programs/${programId}/summary`, targetReport],
      ] as const) {
        await page.goto(origin + path);
        const response = await context.request.get(origin + api); assert.equal(response.status(), 200);
        const returned = await response.json() as { summary?: { id: string; content: unknown } };
        assert.equal(returned.summary?.id, saved.id); assert.deepEqual(returned.summary?.content, saved.content, 'Browser API changed the saved report');
        assert(!Object.hasOwn(returned.summary!,'apiKeyCipher')&&!Object.hasOwn(returned.summary!,'apiKey'),'Browser received provider credentials');
        await page.getByRole('button', { name: 'Summary', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        await dialog.getByRole('heading', { name: 'Recon facts', exact: true }).waitFor();
        const factsRegion = dialog.getByRole('region', { name: 'Recon facts', exact: true });
        const narrativeRegion = dialog.getByRole('region', { name: 'AI synthesis', exact: true });
        assert.equal(await dialog.locator('pre').count(), 0, 'Raw JSON displayed');
        const text = await dialog.innerText(), report = asObject(saved.content);
        assert(text.includes('recon-report/3'), 'Historical renderer used instead of v3');
        assert(text.includes('Provider: '+(saved.provider==='OPENROUTER'?'OpenRouter':'Ollama'))&&text.includes('Model: '+saved.model),'Captured provider/model missing from browser metadata');
        assert(text.includes(scan.id) || saved.scopeAssetId === null, 'Source Recon reference missing');
        const factual = asObject(report.factual), narrative = asObject(report.narrative);
        assert(JSON.stringify(factual).length > 100 && JSON.stringify(narrative).length > 100);
        const normalize = (v: string) => v.replace(/\s+/g, ' ').trim();
        let checkedRows = 0;
        if(factsRender){
          const typed=report as unknown as ReconReportV3,presented=presentReconFacts(typed.factual),expected=presented.sections.flatMap(section=>section.rows);
          const rows=factsRegion.locator('[data-fact-row]');assert.equal(await rows.count(),expected.length,'Useful factual rows are missing');
          for(let index=0;index<expected.length;index++){
            const row=rows.nth(index),primary=row.locator('[data-fact-primary]'),text=normalize(await primary.innerText());
            assert(await primary.isVisible(),'A factual primary is hidden before any expansion');assert(text&&!/^[-–—]+$/.test(text),'A populated observation became a placeholder');
            assert.notEqual(text.toLowerCase(),normalize(expected[index].row.label).toLowerCase(),'A factual primary merely repeats its generic kind');
            assert.equal(text,normalize(expected[index].primary),'A typed factual primary changed in rendering');
            const metrics=await primary.evaluate(element=>{const style=getComputedStyle(element),r=element.getBoundingClientRect();return{width:r.width,height:r.height,fontSize:parseFloat(style.fontSize),opacity:parseFloat(style.opacity),visibility:style.visibility};});
            assert(metrics.width>0&&metrics.height>0&&metrics.fontSize>=12&&metrics.opacity>0&&metrics.visibility==='visible','A factual value is not legible');
            const rowText=normalize(await row.innerText());
            for(const value of Object.values(expected[index].row.details)){
              const display=Array.isArray(value)?value.join(', '):String(value);if(display.trim())assert(rowText.includes(normalize(display)),'An available observation detail is hidden or missing');
            }
            checkedRows++;
          }
          const synthesis=reconSynthesisPresentation(typed),aiText=await narrativeRegion.innerText();
          assert(aiText.includes('AI synthesis: '+synthesis.state),'Actual AI synthesis status is not displayed');
          if(synthesis.failure)assert(aiText.includes(synthesis.failure),'Recorded AI failure reason is missing');
          for(const diagnostic of synthesis.diagnostics)assert(aiText.includes(diagnostic),'Recorded HTTP failure is missing');
          metadata('facts-render-browser',{status:'PASS',surface:saved.scopeAssetId?'scope':'target',sourceRows:typed.factual.sections.reduce((n,s)=>n+s.rows.length,0),visibleUsefulRows:checkedRows,staticAssets:presented.staticAssets,aiState:synthesis.state,aiFailure:synthesis.failure??null,httpDiagnostics:synthesis.diagnostics,manualExpansionNeeded:false,emptyPrimaryRows:0});
          if(process.env.RECON_REPORT_V3_OUTPUT_FILE){
            const surface=saved.scopeAssetId?'scope':'target',factsPath=process.env.RECON_REPORT_V3_OUTPUT_FILE+'.'+surface+'-facts.png',aiPath=process.env.RECON_REPORT_V3_OUTPUT_FILE+'.'+surface+'-ai.png';
            const network=factsRegion.getByRole('region',{name:'Network Surface',exact:true});
            if(await network.count())await network.scrollIntoViewIfNeeded();else await factsRegion.scrollIntoViewIfNeeded();
            await page.screenshot({path:factsPath,fullPage:true});await protectArtifact(factsPath);
            await narrativeRegion.scrollIntoViewIfNeeded();await page.screenshot({path:aiPath,fullPage:true});await protectArtifact(aiPath);
          }
        }else{
        for (const details of await factsRegion.locator(':scope > details').all()) await details.locator('summary').first().click();
        const renderedFacts = normalize(await factsRegion.innerText());
        for (const section of (Array.isArray(factual.sections) ? factual.sections : [])) {
          const rows = asObject(section).rows;
          for (const row of (Array.isArray(rows) ? rows : []).slice(0, 2)) {
            const value = asObject(row).value;
            if (typeof value === 'string' && value.trim()) {
              assert(renderedFacts.includes(normalize(value)), 'A stored factual value is missing from the rendered report'); checkedRows++;
            }
          }
        }
        }
        assert(checkedRows > 0, 'No factual rows were visually checked');
        assert(typeof narrative.attackSurfaceSummary === 'string' && narrative.attackSurfaceSummary.trim(), 'Narrative summary missing');
        if(report.narrativeStatus==='FACTUAL_ONLY')assert((await narrativeRegion.innerText()).includes('did not return a usable response'),'Provider-unavailable facts-only state missing');
        else assert(normalize(await narrativeRegion.innerText()).includes(normalize(narrative.attackSurfaceSummary)), 'Stored model narrative missing from the rendered report');
        await page.getByRole('button', { name: 'Close', exact: true }).click();
      }
      if(routing&&!factsRender){
        for(const configured of ['OPENROUTER','OLLAMA'] as const){
          await page.goto(origin+'/settings');
          const group=page.getByRole('group',{name:'Configured '+configured+' provider',exact:true});
          const changed=page.waitForResponse(r=>r.url().endsWith('/api/ai-providers/default')&&r.request().method()==='POST');
          await group.getByRole('button',{name:'Set '+configured+' as default',exact:true}).click();assert.equal((await changed).status(),200);
          await group.getByText('DEFAULT',{exact:true}).waitFor();
          await page.goto(origin+'/scopes/'+asset.id);await page.getByRole('button',{name:'Summary',exact:true}).click();
          const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Recon facts',exact:true}).waitFor();
          assert((await dialog.innerText()).includes('Provider: '+(assetReport.provider==='OPENROUTER'?'OpenRouter':'Ollama')),'Changing default rewrote historical provider metadata');
          if(configured!==assetReport.provider)await dialog.getByText(/default AI provider is now/).waitFor();
          await page.getByRole('button',{name:'Close',exact:true}).click();
        }
        metadata('browser-default-switch',{status:'PASS',settingsSwitches:['OPENROUTER','OLLAMA'],historicalProviderPreserved:true});
      }
      assert.deepEqual(pageErrors, [], 'Browser reported application errors');
      metadata('browser', { status: 'PASS', exactStoredAssetAndTargetReports: true, rawJsonDisplayed: false, externalBrowserRequestsAllowed: false });
    } else metadata('browser', { status: 'SKIPPED', reason: 'Run against a compiled v3 image with browser acceptance enabled' });
    metadata('complete', { status: 'PASS', sourceSha256, artifacts: source.artifacts.length, realModel: !replayFile, replayOfRealModel: Boolean(replayFile) });
  } finally { globalThis.fetch = originalFetch; }
}

try { await main(); }
catch (error) { metadata(phase, { status: 'FAIL', errorType: error instanceof Error ? error.name : 'Unknown' }); process.exitCode = 1; }
finally {
  await browser?.close();
  if (web && web.exitCode === null) {
    const stopped = new Promise<void>(resolve => web!.once('exit', () => resolve())); web.kill('SIGTERM');
    const timer = setTimeout(() => web?.kill('SIGKILL'), 3000); await stopped; clearTimeout(timer);
  }
  await prisma.$disconnect();
}
