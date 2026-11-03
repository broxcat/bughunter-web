import { BrainClient,BrainError } from '../brain/client';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { REPORT_SYSTEM, ReconReportValidationError, reconReportNarrativeSchema, reportBudget, validateReconReport, type ReconReportInput, type ReportBudget,reportGenerationSchema,reconReportSchema } from '@/lib/reconReport';
const cached = new Map<string, { expires: number; budget: ReportBudget }>();
const validatedModes=new Map<string,{expires:number;think:boolean|string|undefined}>();
/** Model introspection only contacts the operator-configured Ollama endpoint. */
export async function inspectOllamaReportModel(endpoint: string, model: string, signal?: AbortSignal): Promise<ReportBudget> {
  const key = createHash('sha256').update(JSON.stringify([endpoint, model])).digest('hex'), prior = cached.get(key);
  if (prior && prior.expires > Date.now()) return prior.budget;
  try {
    const response = await fetch(`${endpoint}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) });
    if (!response.ok || !response.body) return reportBudget();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; if (bytes > 131072) throw new Error('Model metadata exceeds limit'); chunks.push(item.value); } } finally { await reader.cancel(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model_info?: Record<string, unknown>; thinking?: unknown; capabilities?:string[] };
    const contexts = Object.entries(data.model_info ?? {}).filter(([key, value]) => /(?:^|\.)context_length$/.test(key) && typeof value === 'number').map(([, value]) => value as number);
    const budget = {...reportBudget(contexts.length ? Math.min(...contexts) : undefined, data.thinking,data.capabilities),inspectionKey:key};
    cached.set(key, { expires: Date.now() + 600000, budget }); if (cached.size > 100) cached.delete(cached.keys().next().value!);
    return budget;
  } catch { if (signal?.aborted) signal.throwIfAborted(); return reportBudget(); }
}
export type ReconReportAttempt=z.infer<typeof reportGenerationSchema>['attempts'][number];
function rememberValidatedMode(input:ReconReportInput,think:boolean|string|undefined){
  const key=input.budget.inspectionKey,prior=key?cached.get(key):undefined;
  if(key&&prior){validatedModes.set(key,{expires:prior.expires,think});if(validatedModes.size>100)validatedModes.delete(validatedModes.keys().next().value!);}
}
/** Unknown thinking controls are a declared compatibility trial, never an
 * assumption about model names. A validated result can be cached for that
 * endpoint/model; source input/fingerprint never changes after scheduling. */
export async function generateReconReport(client: BrainClient, input: ReconReportInput, options: { signal?: AbortSignal; timeoutMs?: number; onAttempt?:(attempt:ReconReportAttempt)=>void } = {}) {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 180000), ...(options.signal ? [options.signal] : [])]);
  const schema = z.toJSONSchema(reconReportNarrativeSchema,{reused:'ref'});
  const language=input.metadata.language==='fr'
    ? 'LANGUAGE REQUIREMENT: Write every human-readable narrative field in French (français), including the title, summary, entries, observations, limitations and Research handoff. Keep JSON property names, exact evidence IDs, URLs, tool names and recorded technical facts unchanged.'
    : 'LANGUAGE REQUIREMENT: Write every human-readable narrative field in English. Keep JSON property names, exact evidence IDs, URLs, tool names and recorded technical facts unchanged.';
  const base = REPORT_SYSTEM + '\n'+language+'\nOutput JSON schema:\n' + JSON.stringify(schema);
  const attempts:ReconReportAttempt[]=[],started=Date.now();
  const prior=input.budget.inspectionKey?validatedModes.get(input.budget.inspectionKey):undefined;
  const validated=input.budget.thinkingTrial&&prior&&prior.expires>Date.now()?prior:undefined;
  const modePolicy=validated?'VALIDATED_RESULT':input.budget.thinkingPolicy??'MODEL_DEFAULT';
  let trialMode:boolean|string|undefined=validated?validated.think:input.budget.think,correction='';
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const think=input.budget.thinkingTrial?trialMode:input.budget.think;
    let raw:string;
    try{raw = await client.chat(base + (attempt ? '\nThe prior reply was rejected: '+correction+'. Produce a corrected report from the same evidence. Use only exact evidence[].id references and recorded facts supported by each cited row. Return all required narrative properties; empty arrays are valid where there is no evidence.' : ''), JSON.stringify(input), {
      format: schema, temperature: 0, maxTokens: input.budget.outputTokens, contextWindow: input.budget.contextTokens,
      ...(think !== undefined ? { think } : {}), retries: 0, timeoutMs: options.timeoutMs ?? 180000, maxResponseBytes: 262144, signal,
    });}catch(error){
      // Only an explicit thinking/decoder incompatibility gets a control-mode
      // fallback. An unavailable server/transport does not become a schema retry.
      if(attempt===0&&input.budget.thinkingTrial&&error instanceof BrainError&&(error.status===400||error.status===422||error.status===500&&/thinking|think|token repeat|prediction aborted/i.test(error.message))){
        const trace:ReconReportAttempt={attempt:1,thinkingMode:think??null,responseBytes:0,status:'MODE_REJECTED',issueCodes:['OLLAMA_MODE_REJECTED']};attempts.push(trace);options.onAttempt?.(trace);trialMode=undefined;correction='requested thinking control was incompatible';continue;
      }
      throw error;
    }
    try {
      const report=validateReconReport(raw,input);
      const trace:ReconReportAttempt={attempt:attempt+1,thinkingMode:think??null,responseBytes:Buffer.byteLength(raw),status:'VALID'};attempts.push(trace);options.onAttempt?.(trace);
      if(input.budget.thinkingTrial)rememberValidatedMode(input,think);
      return reconReportSchema.parse({...report,generation:{thinkingMode:think??null,modePolicy,attempts,durationMs:Date.now()-started}});
    }catch (error) {
      const trace:ReconReportAttempt={attempt:attempt+1,thinkingMode:think??null,responseBytes:Buffer.byteLength(raw),status:error instanceof ReconReportValidationError?'FACTUAL_REJECTED':'SCHEMA_REJECTED',issueCodes:error instanceof z.ZodError?[...new Set(error.issues.map(i=>i.code))]:[error instanceof SyntaxError?'INVALID_JSON':'UNSUPPORTED_FACT']};attempts.push(trace);options.onAttempt?.(trace);
      if (attempt || !(error instanceof SyntaxError || error instanceof z.ZodError || error instanceof ReconReportValidationError)) throw error;
      // A factual rejection does not prove a decoder-control incompatibility.
      // Keep that mode for its single grounded correction; fall back only for
      // malformed JSON/schema or an explicit unsupported-control response.
      correction=trace.status==='FACTUAL_REJECTED'?(error as Error).message:trace.issueCodes?.includes('INVALID_JSON')?'invalid JSON':'invalid schema ('+trace.issueCodes!.join(', ')+')';
      if(error instanceof ReconReportValidationError&&error.details){
        const details=error.details;
        // Only application-controlled paths and numeric/enumerated facts enter
        // the system correction. Remote URLs, titles or technology strings
        // remain solely in the original untrusted user-data envelope.
        correction+=' at '+details.location+'; allowed HTTP status codes for these citations: '+JSON.stringify(details.allowedFacts.statusCodes)+'; allowed port/protocol pairs: '+JSON.stringify(details.allowedFacts.ports.map(p=>({port:p.port,protocol:p.protocol})))+'. The facts object and its optional HTTP-status/method arrays may be omitted. Cite a directly supporting evidence row or remove the unsupported field';
      }
      if(input.budget.thinkingTrial&&trace.status==='SCHEMA_REJECTED')trialMode=undefined;
    }
  }
  throw new Error('Report validation failed');
}
