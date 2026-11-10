import Link from 'next/link';
import DeleteResourceButton from './DeleteResourceButton';
import { Badge } from '@/components/ui/Badge';
import { platformLabel } from '@/lib/platformPresentation';
import type { StageState, targetCampaign } from '@/lib/targetCampaign';
import CampaignCommandButton from './CampaignCommandButton';
import CampaignLiveRefresh from './CampaignLiveRefresh';

const tones = { 'not started': 'neutral', running: 'info', done: 'passed', blocked: 'killed', 'needs you': 'medium', failed: 'killed' } as const;
export function CampaignState({ state }: { state: StageState }) {
  return <Badge tone={tones[state]}>{state === 'running' && <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-current motion-safe:animate-pulse" />}{state.charAt(0).toUpperCase() + state.slice(1)}</Badge>;
}

export default function TargetCampaignView({ program, view, notice, summary }: {
  program: { id: string; companyName: string; platform: string | null };
  view: ReturnType<typeof targetCampaign>;
  notice?: string;
  summary?: { hosts: number; webApps: number; added: number; changed: number; notObserved: number } | null;
}) {
  const { id, companyName, platform } = program;
  return <div className="max-w-6xl space-y-6">
    <Link href="/targets" className="text-sm text-brand">← Targets</Link>
    <header className="space-y-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm text-muted">{platformLabel(platform)}</p><h1 className="mt-1 break-words text-2xl font-semibold">{companyName}</h1></div>
        <Link href={'/targets/' + id + '/details'} prefetch={false} className="text-sm text-brand underline">View details</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Current campaign stage">
        <span className="font-medium">{view.current.stage}</span><CampaignState state={view.current.state} />
      </div>
      <p className="text-sm text-muted"><strong>Next.</strong> {view.next}</p>
      <div className="flex flex-wrap items-start gap-2">
        {'command' in view.action ? <CampaignCommandButton programId={id} {...view.action} />
          : <Link className="ui-btn" data-variant="primary" href={view.action.href} prefetch={false}>{view.action.label}</Link>}
        {view.campaign && view.activity.active && !['PAUSED', 'BLOCKED'].includes(view.campaign.state) && <CampaignCommandButton programId={id} command="pause" label="Pause campaign" secondary />}
        {view.campaign?.state === 'MONITORING' && 'href' in view.action && <CampaignCommandButton programId={id} command="start" label="Start cycle" secondary />}
      </div>
    </header>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {view.campaign?.state === 'PAUSED' && <p role="status" className="text-sm">Campaign paused. Queued jobs are cancelled and a running job may finish.</p>}
    {Boolean(view.campaign?.pendingCount) && <p className="text-sm"><Link className="text-brand underline" href={'/targets/' + id + '/settings#scope-import-review'}>
      {view.campaign!.pendingCount} {view.campaign!.pendingCount === 1 ? 'new asset' : 'new assets'} to review
    </Link></p>}
    <DeleteResourceButton kind="Target" name={companyName} url={'/api/programs/' + id} redirectTo="/targets?deleted=1" />
    <section aria-label="Campaign stages">
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.stages.map((step, index) => <li key={step.stage} id={step.stage.toLowerCase()}
          aria-current={step.stage === view.current.stage ? 'step' : undefined}
          className="relative scroll-mt-24 space-y-2 rounded-lg border border-border bg-surface p-4 aria-[current=step]:border-border-strong aria-[current=step]:bg-surface-2">
          {index < view.stages.length - 1 && <span aria-hidden="true" className="absolute left-full top-6 hidden h-px w-3 bg-border-strong lg:block" />}
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold"><span aria-hidden="true" className="mr-1.5 text-xs text-muted">{index + 1}</span>{step.stage}</h2><CampaignState state={step.state} /></div>
          {step.detail && <p className="text-sm text-muted" role={['blocked', 'running', 'failed', 'needs you'].includes(step.state) ? 'status' : undefined}>{step.detail}</p>}
          {step.stage === 'Recon' && step.state === 'done' && summary && <ul className="space-y-1 text-xs text-muted">
            <li>{summary.hosts} discovered hosts</li><li>{summary.webApps} active web apps</li>
            <li>Changes · {summary.added} new, {summary.changed} changed, {summary.notObserved} not observed</li>
          </ul>}
          {step.fix && step.fix !== ('href' in view.action ? view.action.href : undefined) &&
            <Link href={step.fix} prefetch={false} className="text-sm text-brand underline">{step.stage === 'Recon' ? 'Open Recon history' : step.stage === 'Research' ? 'Open Research details' : 'Resolve this block'}</Link>}
        </li>)}
      </ol>
    </section>
    {view.activity.active && <CampaignLiveRefresh activity={[{ id, ...view.activity }]} />}
  </div>;
}
