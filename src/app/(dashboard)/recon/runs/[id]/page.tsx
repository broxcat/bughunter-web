import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { loadTargetReconRun } from '@/server/recon/runDetail';
import { ResearchError } from '@/server/research/workspace';
import { reconOverview, type ReconTone } from '@/lib/reconOverview';
import { capabilityRows, elapsed, formatDuration, groupObservationKinds, redactLogLines, stageTools, stepView, type StepTone } from '@/lib/reconTimeline';
import { buildReconReportModel } from '@/lib/reconReportModel';
import { loadReconReportFacts } from '@/server/recon/reportFacts';
import ReconReportView from '@/components/ReconReportView';

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

function hostCounts(snapshot: unknown): number {
  return Array.isArray(snapshot) ? snapshot.length : 0;
}

export default async function ReconRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const { run, observations, logs, rawLogLimit } = detail;
  const view = reconOverview({ status: run.status, outcome: run.outcome });
  const duration = elapsed(run.startedAt ?? run.createdAt, run.finishedAt);
  const contextCount = run.scans.reduce((sum, scan) => sum + hostCounts(scan.authenticatedContextsSnapshot), 0);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Link href="/recon" className="text-brand">← Recon</Link>
      <span aria-hidden className="text-subtle">/</span>
      <Link href={`/targets/${run.program.id}?tab=Recon`} className="text-brand">{run.program.companyName}</Link>
    </div>

    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Recon run</h1>
        <Badge tone={badgeTone[view.tone]}>{view.label}</Badge>
        <Badge tone="neutral" mono>{run.status}</Badge>
        <a className="ml-auto text-sm text-brand" href={`/api/recon/runs/${run.id}/report`}>Download report (.md)</a>
      </div>
      {view.detail && <p className="text-sm text-muted">{view.detail}</p>}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-subtle">Started</dt><dd>{stamp(run.startedAt ?? run.createdAt)}</dd></div>
        <div><dt className="text-subtle">Duration</dt><dd>{duration ?? 'Not recorded'}</dd></div>
        <div><dt className="text-subtle">Hosts scanned</dt><dd>{run.scans.length}</dd></div>
        <div><dt className="text-subtle">Required User-Agent</dt><dd className="break-all font-mono text-xs">{run.program.requiredUserAgent ?? 'Not recorded'}</dd></div>
        <div><dt className="text-subtle">Assessment mode</dt><dd>{run.program.assessmentMode.toLowerCase().replaceAll('_', ' ')}</dd></div>
        <div><dt className="text-subtle">Authenticated contexts</dt><dd>{contextCount > 0 ? `${contextCount} recorded` : 'None recorded'}</dd></div>
      </dl>
    </header>

    <ReconReportView model={report} />

    <h2 className="pt-2 text-xl font-semibold">Per-host execution detail</h2>

    {!run.scans.length && <Card className="p-5"><h2 className="font-semibold">No host executions recorded</h2><p className="mt-2 text-sm text-muted">This run has no per-host execution data. The run status above remains authoritative; nothing is inferred.</p></Card>}

    {run.scans.map(scan => {
      const scanView = reconOverview({ status: scan.status, outcome: scan.outcome });
      const plan = scan.reconPlan as { stages?: Array<{ name: string; tools?: string[] }> } | null;
      const limitations = scan.reconSteps.filter(step => stepView(step.state).limitation);
      const observationsForRun = observations[scan.id] ?? [];
      const lines = redactLogLines(logs[scan.id] ?? []);
      return <Card key={scan.id} className="space-y-5 p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="break-all font-mono text-lg font-semibold">{scan.scopeAsset?.normalizedValue ?? 'Unknown host'}</h2>
          <Badge tone={badgeTone[scanView.tone]}>{scanView.label}</Badge>
          <Badge tone="neutral" mono>{scan.status}</Badge>
          <span className="text-sm text-muted">{scan._count.artifacts} observations</span>
          {scan.scopeAsset && <Link className="ml-auto text-sm text-brand" href={`/scopes/${scan.scopeAsset.id}`}>Host evidence →</Link>}
        </div>

        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="text-subtle">Started</dt><dd>{stamp(scan.startedAt ?? scan.createdAt)}</dd></div>
          <div><dt className="text-subtle">Duration</dt><dd>{elapsed(scan.startedAt, scan.finishedAt) ?? 'Not recorded'}</dd></div>
          <div><dt className="text-subtle">User-Agent</dt><dd className="break-all font-mono text-xs">{scan.requiredUserAgent ?? 'Not recorded'}</dd></div>
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
                return <li key={step.name} className="border-l-2 border-border pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden className={stepState.tone === 'danger' ? 'text-danger' : stepState.tone === 'warning' ? 'text-warning' : stepState.tone === 'success' ? 'text-success' : 'text-subtle'}>{stepState.symbol}</span>
                    <span className="font-medium">{step.name}</span>
                    <Badge tone={badgeTone[stepState.tone]}>{stepState.label}</Badge>
                    {formatDuration(details?.durationMs) && <span className="text-xs text-muted">{formatDuration(details?.durationMs)}</span>}
                  </div>
                  {tools.length > 0 && <p className="mt-1 font-mono text-xs text-muted">{tools.join(' · ')}</p>}
                  {step.reason && <p className="mt-1 text-sm text-muted">{step.reason}</p>}
                  {caps.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {caps.map(cap => <li key={cap.capability}>{cap.capability.replaceAll('_', ' ').toLowerCase()} · {stepView(cap.state).label}</li>)}
                  </ul>}
                </li>;
              })}
            </ol>}
        </section>

        <section aria-label="Observations">
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

        {limitations.length > 0 && <section aria-label="Limitations">
          <h3 className="mb-2 font-semibold">Failures and limitations</h3>
          <ul className="space-y-1 text-sm">
            {limitations.map(step => <li key={step.name}><span className="font-medium">{step.name}</span> · {stepView(step.state).label}{step.reason ? ` — ${step.reason}` : ''}</li>)}
          </ul>
        </section>}

        <details className="rounded border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Raw execution output ({lines.length}{lines.length >= rawLogLimit ? ` of the latest ${rawLogLimit}` : ''} lines)</summary>
          {lines.length
            ? <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-3 font-mono text-xs leading-relaxed">{lines.map((line, index) => <span key={index} className={line.stream === 'STDERR' ? 'block text-danger' : 'block'}>{line.text}</span>)}</pre>
            : <p className="mt-2 text-sm text-muted">No raw output was recorded. Open host evidence for the complete artifact set.</p>}
          {lines.length >= rawLogLimit && <p className="mt-2 text-xs text-muted">Only the most recent {rawLogLimit} lines are shown here. Stored logs are unchanged and remain available from the host page.</p>}
        </details>
      </Card>;
    })}

    <p className="text-sm text-muted">Completed does not imply success. Missing coverage never proves safety.</p>
  </div>;
}
