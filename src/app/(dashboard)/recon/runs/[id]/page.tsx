import {readRunNarrative} from '@/server/recon/runNarrative';
import Link from 'next/link';
import ReconRunRefresh from '@/components/ReconRunRefresh';
import { paginationInput } from '@/lib/pagination';
import { redactObservationText } from '@/lib/observationSafety';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';

import { loadTargetReconRun } from '@/server/recon/runDetail';
import { ResearchError } from '@/server/research/workspace';
import { reconOverview, type ReconTone } from '@/lib/reconOverview';
import { authContextCount, capabilityRows, providerAttempts, elapsed, formatDuration, groupObservationKinds, redactLogLines, stageTools, stepView, type StepTone } from '@/lib/reconTimeline';
import { buildReconReportModel } from '@/lib/reconReportModel';
import { loadReconReportFacts } from '@/server/recon/reportFacts';
import ReconHostReport from '@/components/ReconHostReport';

export const dynamic = 'force-dynamic';

const badgeTone: Record<ReconTone | StepTone, 'neutral' | 'brand' | 'passed' | 'medium' | 'killed'> = {
  idle: 'neutral',
  active: 'brand',
  success: 'passed',
  warning: 'medium',
  danger: 'killed',
};

function stamp(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default async function ReconRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ historyPage?: string; historyPageSize?: string }> }) {
  const { id } = await params;
  const search = await searchParams;
  const history = paginationInput(new URLSearchParams({page: search.historyPage ?? '1', pageSize: search.historyPageSize ?? '25'}), false);
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  let detail: Awaited<ReturnType<typeof loadTargetReconRun>>;
  try {
    detail = await loadTargetReconRun(session.user.id, id);
  } catch (error) {
    if (error instanceof ResearchError && error.status === 404) notFound();
    throw error;
  }

  const facts = await loadReconReportFacts(session.user.id, id);
  const report = buildReconReportModel(facts);
  const narrative = await readRunNarrative(session.user.id,facts,report);
  const { run, observations, logs, rawLogLimit } = detail;
  const view = reconOverview({ status: run.status, outcome: run.outcome });
  const duration = elapsed(run.startedAt ?? run.createdAt, run.finishedAt);
  const contextCount = run.scans.reduce((sum, scan) => sum + authContextCount(scan.authenticatedContextsSnapshot), 0);

  return <div className="space-y-6">
    <ReconRunRefresh programId={run.program.id} runId={run.id} status={run.status}/>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Link href="/recon" className="text-brand">← Recon</Link>
      <span aria-hidden className="text-subtle">/</span>
      <Link href={`/recon?program=${run.program.id}&page=${history.page}&pageSize=${history.pageSize}`} className="text-brand">Run history</Link>
      <Link href={`/targets/${run.program.id}?tab=Recon`} className="text-brand">{run.program.companyName}</Link>
    </div>

    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="break-all text-2xl font-semibold">{run.scans.length===1?redactObservationText(run.scans[0].capturedHost??run.program.companyName):run.program.companyName} <span className="font-normal text-muted">/ Recon run</span></h1>
        <Badge tone={badgeTone[view.tone]}>{view.label}</Badge>

      </div>
      {view.detail && <p className="text-sm text-muted">{view.detail}</p>}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-subtle">Started</dt><dd>{stamp(run.startedAt ?? run.createdAt)}</dd></div>
        <div><dt className="text-subtle">Duration</dt><dd>{duration ?? 'Not recorded'}</dd></div>
      </dl>
    </header>



    <ReconHostReport report={report.report} program={report.metadata.program} runStatus={`${report.metadata.status} · ${report.metadata.outcomeLabel}`} collectionDate={report.metadata.reconDate}/>

    <h2 className="border-t border-border pt-6 text-lg font-semibold">Exécution technique</h2>
    <p className="text-sm text-muted">Étapes, outils, fallbacks, erreurs, invocations et journaux du run source.</p>

    {!run.scans.length && <section className="border-t border-border py-4"><h2 className="font-semibold">No host executions recorded</h2><p className="mt-2 text-sm text-muted">This run has no per-host execution data. The run status above remains authoritative; nothing is inferred.</p></section>}

    {run.scans.map(scan => {
      const scanView = reconOverview({ status: scan.status, outcome: scan.outcome });
      const plan = scan.reconPlan as { stages?: Array<{ name: string; tools?: string[] }> } | null;
      const limitations = scan.reconSteps.filter(step => stepView(step.state).limitation);
      const observationsForRun = observations[scan.id] ?? [];
      const lines = redactLogLines(logs[scan.id] ?? []);
      return <section key={scan.id} className="space-y-5 border-t border-border py-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="break-all font-mono text-lg font-semibold">{redactObservationText(scan.capturedHost ?? 'Host not captured')}</h2>
          <Badge tone={badgeTone[scanView.tone]}>{scanView.label}</Badge>

          <span className="text-sm text-muted">{scan._count.artifacts} observations</span>
          {scan.scopeAsset && <Link className="ml-auto text-sm text-brand" href={`/scopes/${scan.scopeAsset.id}`}>Host evidence →</Link>}
        </div>

        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="text-subtle">Started</dt><dd>{stamp(scan.startedAt ?? scan.createdAt)}</dd></div>
          <div><dt className="text-subtle">Duration</dt><dd>{elapsed(scan.startedAt, scan.finishedAt) ?? 'Not recorded'}</dd></div>

        </dl>

        <section aria-label={`Execution timeline for ${scan.scopeAsset?.normalizedValue ?? 'host'}`}>
          <h3 className="mb-3 font-semibold">Execution timeline</h3>
          {!scan.reconSteps.length
            ? <p className="text-sm text-muted">No stage detail was recorded for this run. Historical runs remain readable but cannot be reconstructed.</p>
            : <ol className="space-y-3">
              {scan.reconSteps.map(step => {
                const stepState = stepView(step.state);
                const tools = stageTools(step.name, plan);
                const details = step.details as { durationMs?: unknown } | null;
                const caps = capabilityRows(step.details);
                const attempts = providerAttempts(step.details);
                return <li key={step.name} className="border-l-2 border-border pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden className={stepState.tone === 'danger' ? 'text-danger' : stepState.tone === 'warning' ? 'text-muted' : stepState.tone === 'success' ? 'text-muted' : 'text-subtle'}>{stepState.symbol}</span>
                    <span className="font-medium">{step.name}</span>
                    <Badge tone={badgeTone[stepState.tone]}>{stepState.label}</Badge>
                    {formatDuration(details?.durationMs) && <span className="text-xs text-muted">{formatDuration(details?.durationMs)}</span>}
                  </div>
                  {tools.length > 0 && <p className="mt-1 font-mono text-xs text-muted">Planned tools: {tools.join(' · ')}</p>}
                  {step.reason && <p className="mt-1 text-sm text-muted">{redactObservationText(step.reason)}</p>}
                  {(attempts.length>0||caps.length>0)&&<details className="mt-2 text-sm"><summary>Details</summary>
                  {attempts.length > 0 && <ul className="mt-2 space-y-1 text-sm">
                    {attempts.map((attempt, index) => <li key={index}>
                      <span className="font-mono">{attempt.provider}</span> · {stepView(attempt.state).label}
                      {attempt.duration && <span> · {attempt.duration}</span>}
                      {attempt.observations !== null && <span> · {attempt.observations} observations</span>}
                      {attempt.reason && <p className="text-muted">{attempt.reason}</p>}
                    </li>)}
                  </ul>}
                  {caps.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {caps.map(cap => <li key={cap.capability}>{cap.capability.replaceAll('_', ' ').toLowerCase()} · {stepView(cap.state).label}</li>)}
                  </ul>}
                  </details>}
                </li>;
              })}
            </ol>}
        </section>

        <details className="ui-disclosure"><summary>Observations</summary><section aria-label="Observations" className="mt-3">
          <h3 className="mb-2 font-semibold">Observations</h3>
          {observationsForRun.length
            ? <ul className="space-y-1 text-sm">
              {groupObservationKinds(observationsForRun).map(group => <li key={group.label}>
                {group.label}: <span className="font-medium">{group.count}</span>
                {group.kinds.length > 1 && <span className="text-muted"> ({group.kinds.map(kind => `${kind.kind} ${kind.count}`).join(', ')})</span>}
              </li>)}
            </ul>
            : <p className="text-sm text-muted">No Recon artifacts were recorded for this host. Missing observations do not demonstrate absence.</p>}
          <p className="mt-2 text-xs text-muted">Observations are evidence, not confirmed vulnerabilities.</p>
        </section>

        </details>
        {limitations.length > 0 && <section aria-label="Limitations">
          <h3 className="mb-2 font-semibold">Failures and limitations</h3>
          <ul className="space-y-1 text-sm">
            {limitations.map(step => <li key={step.name}><span className="font-medium">{step.name}</span> · {stepView(step.state).label}{step.reason ? ` — ${redactObservationText(step.reason)}` : ''}</li>)}
          </ul>
        </section>}

        <details className="ui-disclosure">
          <summary className="cursor-pointer text-sm font-medium">Raw execution output ({lines.length}{lines.length >= rawLogLimit ? ` of the latest ${rawLogLimit}` : ''} lines)</summary>
          {lines.length
            ? <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-3 font-mono text-xs leading-relaxed">{lines.map((line, index) => <span key={index} className="block"><span className="text-muted">[{line.stream}] </span>{line.text}</span>)}</pre>
            : <p className="mt-2 text-sm text-muted">No raw output was recorded. Open host evidence for the complete artifact set.</p>}
          {lines.length >= rawLogLimit && <p className="mt-2 text-xs text-muted">Only the most recent {rawLogLimit} lines are shown here. Stored logs are unchanged and remain available from the host page.</p>}
        </details>
      </section>;
    })}

    <details className="ui-disclosure"><summary>Technical details</summary><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">        <div><dt className="text-subtle">Asset executions recorded</dt><dd>{run.scans.length}</dd></div>
        <div><dt className="text-subtle">Current target User-Agent</dt><dd className="break-all font-mono text-xs">{redactObservationText(run.program.requiredUserAgent ?? 'Not recorded')}</dd></div>
        <div><dt className="text-subtle">Assessment mode</dt><dd>{run.assessmentModeSnapshot?.toLowerCase().replaceAll('_', ' ') ?? 'Not captured'}</dd></div>
        <div><dt className="text-subtle">Authenticated contexts</dt><dd>{contextCount > 0 ? `${contextCount} recorded` : 'None recorded'}</dd></div>
<div><dt className="text-muted">Run ID</dt><dd className="break-all font-mono text-xs">{run.id}</dd></div></dl></details>
    {narrative.state === 'AI_ASSISTED' && <p className="text-xs text-muted">Une synthèse IA historique existe pour ce run, mais le rapport déterministe ci-dessus reste autoritaire.</p>}
    <p className="text-xs text-muted">Missing coverage never proves safety.</p>
  </div>;
}
