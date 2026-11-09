import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { platformLabel } from '@/lib/platformPresentation';
import type { StageState, targetCampaign } from '@/lib/targetCampaign';
import TargetReconActions from './TargetReconActions';
import CampaignLiveRefresh from './CampaignLiveRefresh';

const tones = { 'not started': 'neutral', running: 'brand', done: 'passed', blocked: 'killed' } as const;
export function CampaignState({ state }: { state: StageState }) {
  return <Badge tone={tones[state]}>{state.charAt(0).toUpperCase() + state.slice(1)}</Badge>;
}

export default function TargetCampaignView({ program, view, notice }: {
  program: { id: string; companyName: string; platform: string | null };
  view: ReturnType<typeof targetCampaign>;
  notice?: string;
}) {
  const { id, companyName, platform } = program;
  return <div className="max-w-4xl space-y-6">
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
      {'startRecon' in view.action
        ? <TargetReconActions programId={id} running={false} startLabel={view.action.label} />
        : <Link className="ui-btn" data-variant="primary" href={view.action.href} prefetch={false}>{view.action.label}</Link>}
    </header>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <section aria-label="Campaign stages">
      <ol className="grid gap-3 sm:grid-cols-2">
        {view.stages.map(step => <li key={step.stage} id={step.stage.toLowerCase()}
          aria-current={step.stage === view.current.stage ? 'step' : undefined}
          className="scroll-mt-24 space-y-2 rounded-lg border border-border bg-surface p-4 aria-[current=step]:border-brand">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{step.stage}</h2><CampaignState state={step.state} /></div>
          {step.detail && <p className="text-sm text-muted" role={step.state === 'blocked' || step.state === 'running' ? 'status' : undefined}>{step.detail}</p>}
          {step.fix && step.fix !== ('href' in view.action ? view.action.href : undefined) &&
            <Link href={step.fix} prefetch={false} className="text-sm text-brand underline">{step.stage === 'Recon' ? 'Open Recon history' : step.stage === 'Research' ? 'Open Research details' : 'Resolve this block'}</Link>}
        </li>)}
      </ol>
    </section>
    {view.activity.active && <CampaignLiveRefresh activity={[{ id, ...view.activity }]} />}
  </div>;
}
