import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { ReconPlan } from '@/lib/reconPlanner';
import { classifyReconFailure, evaluateCapability, requiredCoverageSatisfied, type ReconCapability, type ReconCapabilityResult, type ReconProviderAttempt, type ReconFailure } from '@/lib/reconCapabilities';
import { throwIfScanAborted } from '../scanControl';
import { publishScanLog } from '../queue/logBus';
const good = new Set(['COMPLETED', 'COMPLETED_WITH_FALLBACK', 'SKIPPED_NOT_APPLICABLE']);
export class ReconCoverage {
  readonly results: ReconCapabilityResult[] = [];
  private stageName = '';
  private attempts = new Map<ReconCapability, ReconProviderAttempt[]>();
  private annotations: Record<string, unknown> = {};
  constructor(readonly scanRunId: string, readonly plan: ReconPlan) {}
  async log(line: string) {
    const createdAt = new Date();
    await prisma.scanLog.create({ data: { scanRunId: this.scanRunId, line, stream: 'STDOUT', createdAt } });
    await publishScanLog(this.scanRunId, { line, stream: 'STDOUT', createdAt: createdAt.toISOString() }).catch(() => {});
  }
  annotate(key: string, value: unknown) { this.annotations[key] = value; }
  note(id: ReconCapability, provider: string, coverageSatisfied: boolean, options: Partial<ReconProviderAttempt> = {}) {
    const rows = this.attempts.get(id) ?? [];
    rows.push({ provider, coverageSatisfied, state: coverageSatisfied ? 'COMPLETED' : 'PARTIAL', artifactsProduced: 0, durationMs: 0, ...options });
    this.attempts.set(id, rows);
  }
  capabilityFor(tool: string): ReconCapability {
    return this.plan.capabilities?.find(c => c.stage === this.stageName && c.providers.includes(tool))?.id ??
      (tool === 'gobuster' && this.stageName === 'Scope validation / DNS' ? 'ACTIVE_DNS_DISCOVERY' :
      this.plan.capabilities?.find(c => c.stage === this.stageName)?.id ?? 'AUTHORIZATION');
  }
  async provider<T>(id: ReconCapability, provider: string, work: () => Promise<T>, satisfied: (result: T) => boolean = () => true, fallback = false): Promise<T> {
    const start = Date.now(), before = await prisma.reconArtifact.count({ where: { scanRunId: this.scanRunId } });
    try {
      const result = await work();
      const covered = satisfied(result);
      this.note(id, provider, covered, { ...(id==='CONTENT_DISCOVERY'&&provider==='bounded-crawler'?{coverageBasis:'CALIBRATED_ENUMERATION' as const}:{}), fallback, durationMs: Date.now() - start, artifactsProduced: Math.max(0, await prisma.reconArtifact.count({ where: { scanRunId: this.scanRunId } }) - before) });
      return result;
    } catch (error) {
      const failure = classifyReconFailure(error, id, provider);
      const state = ['MISSING_TOOL', 'INCOMPATIBLE_TOOL', 'MISSING_WORDLIST', 'MISSING_TEMPLATE'].includes(failure.reason) ? 'SKIPPED_UNSUPPORTED' :
        ['RATE_LIMITED', 'WAF_BLOCKED'].includes(failure.reason) ? 'BLOCKED' : failure.reason === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      this.note(id, provider, false, { state, fallback, failure, durationMs: Date.now() - start, artifactsProduced: Math.max(0, await prisma.reconArtifact.count({ where: { scanRunId: this.scanRunId } }) - before) });
      await this.log(`${id}: ${provider} ${state} · ${failure.reason} · ${failure.message}`);
      throw error;
    }
  }
  async stage(name: ReconPlan['stages'][number]['name'], work: () => Promise<void>, skip?: string) {
    throwIfScanAborted();
    this.stageName = name; this.attempts = new Map(); this.annotations = {};
    const phase = this.plan.stages.find(s => s.name === name)!;
    const capabilities = this.plan.capabilities?.filter(c => c.stage === name) ?? [];
    const startedAt = new Date(); let failure: ReconFailure | undefined;
    await prisma.reconPipelineStep.update({ where: { scanRunId_name: { scanRunId: this.scanRunId, name } }, data: { state: 'RUNNING', startedAt, capability: capabilities.map(c => c.id).join(',') || null } });
    if (!phase.enabled || skip) {
      for (const c of capabilities) this.results.push({ ...evaluateCapability({ ...c, enabled: false }, []), reason: skip ?? phase.reason });
      await prisma.reconPipelineStep.update({ where: { scanRunId_name: { scanRunId: this.scanRunId, name } }, data: { state: 'SKIPPED_NOT_APPLICABLE', reason: skip ?? phase.reason, finishedAt: new Date() } }); return;
    }
    try { await work(); }
    catch (error) { throwIfScanAborted(); failure = classifyReconFailure(error, capabilities.find(c => c.required)?.id ?? capabilities[0]?.id ?? 'AUTHORIZATION'); }
    const results = capabilities.map(c => {
      let attempts = this.attempts.get(c.id) ?? [];
      // Internal stages still have an explicit objective and must finish their
      // work before this completion is recorded. Tool stages record attempts.
      if (!attempts.length) attempts = [{ provider: c.providers[0] ?? 'internal', coverageSatisfied: !failure, state: failure ? ['RATE_LIMITED','WAF_BLOCKED'].includes(failure.reason)?'BLOCKED':failure.reason==='CANCELLED'?'CANCELLED':'FAILED' : 'COMPLETED', durationMs: Date.now() - startedAt.getTime(), artifactsProduced: 0, ...(failure ? { failure } : {}) }];
      const result = evaluateCapability(c, attempts);
      if(failure&&c.required&&['RATE_LIMITED','WAF_BLOCKED','CANCELLED'].includes(failure.reason))return{...result,state:failure.reason==='CANCELLED'?'CANCELLED' as const:'BLOCKED' as const,coverageImpact:'BLOCKED' as const,reason:failure.message};
      if (failure && c.required && good.has(result.state)) return { ...result, state: 'PARTIAL' as const, coverageImpact: 'REDUCED' as const, reason: failure.message };
      return result;
    });
    this.results.push(...results);
    const unmet = results.filter(r => !good.has(r.state));
    const state = unmet.some(r=>r.required) ? unmet.some(r=>r.state==='BLOCKED')?'BLOCKED':unmet.some(r=>r.state==='CANCELLED')?'CANCELLED':'PARTIAL' :
      results.some(r=>r.state==='COMPLETED_WITH_FALLBACK')?'COMPLETED_WITH_FALLBACK':
      unmet.length===results.length&&unmet.length ? unmet.every(r=>r.state==='SKIPPED_UNSUPPORTED')?'SKIPPED_UNSUPPORTED':unmet.some(r=>r.state==='BLOCKED')?'BLOCKED':unmet.every(r=>r.state==='FAILED')?'FAILED':'PARTIAL':
      failure||unmet.length?'PARTIAL':'COMPLETED';
    const reason = (results.map(r=>`${r.capability.replaceAll('_',' ')}: ${r.state} (${r.providersSelected.join(', ')||r.providersAttempted.map(a=>a.failure?.reason??a.provider).join(', ')||'no provider'}).`).join(' ') || failure?.message || phase.reason);
    const details = { schemaVersion: 2, capabilities: results, ...this.annotations, durationMs: Date.now() - startedAt.getTime() };
    await prisma.reconPipelineStep.update({ where: { scanRunId_name: { scanRunId: this.scanRunId, name } }, data: { state, reason: reason.slice(0, 1500), details: details as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
    await this.log(`${name}: ${state} · ${reason}`);
    if (failure && name === 'Preflight') throw failure;
  }
  get complete() { return requiredCoverageSatisfied(this.results) && (this.plan.capabilities??[]).filter(c=>c.required&&c.enabled).every(c=>this.results.some(r=>r.capability===c.id&&good.has(r.state))); }
}
