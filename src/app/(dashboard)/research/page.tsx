import Link from 'next/link';
import { notFound } from 'next/navigation';
import CollectionPager from '@/components/CollectionPager';
import ResearchStagePanel from '@/components/ResearchStagePanel';
import { CampaignState } from '@/components/TargetCampaignView';
import { auth } from '@/lib/auth';
import { paginationBounds, paginationInput } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { loadTargetCampaign } from '@/server/targetCampaign';
import { assertResearchTarget, researchTargetSelect } from '@/server/research/workspace';
import { ownedResearch } from '@/server/research/sessions';

export default async function ResearchPage({ searchParams }: {
  searchParams: Promise<{ program?: string; page?: string; pageSize?: string; q?: string; historyPage?: string; view?: string }>;
}) {
  const search = await searchParams;
  const filter = search.program;
  const query = new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const input = paginationInput(query, false);
  const historyInput = paginationInput(new URLSearchParams({ page: search.historyPage ?? '1', pageSize: String(input.pageSize) }), false);
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  if (filter && search.view === 'campaign') {
    const campaign = await loadTargetCampaign(userId, filter);
    if (!campaign) notFound();
    const stage = campaign.view.stages[2];
    return <div className="max-w-3xl space-y-5">
      <Link href={'/targets/' + filter} className="text-sm text-brand">← {campaign.program.companyName}</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">Research</h1><CampaignState state={stage.state} /></div>
      {stage.detail && <p className="text-sm text-muted">{stage.detail}</p>}
      <p>Review the current Recon evidence and run the automated Research analysis.</p>
      <div className="flex flex-wrap gap-4">
        {campaign.view.campaign?.handoffRunId && <a className="text-brand underline" href={'/api/programs/' + filter + '/campaign/handoff'}>Download prepared handoff</a>}
        <Link className="text-brand underline" href={'/research?program=' + filter + '&view=details'} prefetch={false}>Open Research</Link>
      </div>
    </div>;
  }

  const result = await prisma.$transaction(async tx => {
    const where = {
      userId,
      ...(filter ? { programId: filter } : {}),
      OR: [{ active: true }, { scopeAsset: { active: true } }],
      program: { ownerId: userId },
      ...(input.q ? { host: { contains: input.q, mode: 'insensitive' as const } } : {}),
    };
    const bounds = paginationBounds(input, await tx.target.count({ where }));
    const targets = await tx.target.findMany({
      where,
      skip: bounds.skip,
      take: bounds.pageSize,
      select: {
        ...researchTargetSelect,
        scanRuns: {
          where: { type: 'RECON' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, status: true, outcome: true },
        },
      },
      orderBy: [{ host: 'asc' }, { id: 'asc' }],
    });
    const historyWhere = {
      ...ownedResearch(userId),
      ...(filter ? { target: { ...ownedResearch(userId).target, programId: filter } } : {}),
      ...(input.q ? { targetHost: { contains: input.q, mode: 'insensitive' as const } } : {}),
    };
    const historyBounds = paginationBounds(historyInput, await tx.researchSession.count({ where: historyWhere }));
    const history = await tx.researchSession.findMany({
      where: historyWhere,
      select: { id: true, targetHost: true, programName: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: historyBounds.skip,
      take: historyBounds.pageSize,
    });
    return { bounds, targets, historyBounds, history };
  }, { isolationLevel: 'RepeatableRead' });

  const available = result.targets.filter(target => {
    try { assertResearchTarget(target, userId); return true; } catch { return false; }
  });

  return <div className="space-y-6">
    <h1 className="text-2xl font-semibold">Research</h1>
    <p className="text-sm text-muted">Analyze current Recon evidence with the AI provider configured in Settings. No native terminal or external MCP service is required.</p>
    <form action="/research" className="flex flex-wrap gap-3">
      <label>Search hosts<input name="q" defaultValue={input.q} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2" /></label>
      <input type="hidden" name="program" value={filter ?? ''} />
      {filter && <input type="hidden" name="view" value="details" />}
      <input type="hidden" name="pageSize" value={input.pageSize} />
      <button className="ui-btn" type="submit">Search</button>
    </form>
    <CollectionPager path="/research" query={query.toString()} {...result.bounds} label="Research hosts pages" noun="authorized hosts" />
    {!available.length && <p>No authorized Research target is available on this page. Review the current scope in <Link href="/scopes" className="text-brand">Scope</Link>.</p>}
    <ul className="space-y-3">{available.map(target => <li key={target.id} className="space-y-3 border-b border-border py-5">
      <div><p>{target.program!.companyName}</p><h2 className="break-all font-medium">{target.host}</h2><p className="text-sm text-muted">Recon: {target.scanRuns[0]?.outcome?.toLowerCase() ?? target.scanRuns[0]?.status.toLowerCase() ?? 'not run'}</p></div>
      <ResearchStagePanel title="Analyze Recon evidence" targetId={target.id} input={{ stage: 'map' }} />
    </li>)}</ul>
    <details open={Boolean(search.historyPage)}>
      <summary>Research sessions</summary>
      <CollectionPager path="/research" query={query.toString()} {...result.historyBounds} pageKey="historyPage" label="Research history pages" />
      {!result.history.length && <p>No Research sessions match this view.</p>}
      <ul className="space-y-2 pt-3">{result.history.map(item => <li key={item.id}><Link className="text-brand" href={'/research/history/' + item.id}>{item.programName} / {item.targetHost} · {item.createdAt.toISOString()}</Link></li>)}</ul>
    </details>
  </div>;
}
