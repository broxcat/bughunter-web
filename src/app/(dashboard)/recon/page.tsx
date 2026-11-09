import {platformLabel} from '@/lib/platformPresentation';
import Link from 'next/link';
import TargetReconActions from '@/components/TargetReconActions';
import { reconRunHistory } from '@/server/recon/runHistory';
import { ResearchError } from '@/server/research/workspace';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {programCollection} from '@/server/programCollection';
import {paginationInput} from '@/lib/pagination';
import CollectionPager from '@/components/CollectionPager';
import { Badge } from '@/components/ui/Badge';
import { reconOverview, type ReconTone } from '@/lib/reconOverview';

export const dynamic = 'force-dynamic';

const badgeTone: Record<ReconTone, 'neutral' | 'brand' | 'passed' | 'medium' | 'killed'> = {
  idle: 'neutral',
  active: 'brand',
  success: 'passed',
  warning: 'medium',
  danger: 'killed',
};

/** Deterministic UTC rendering; avoids server/client timezone drift. */
function stamp(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default async function ReconPage({ searchParams }: { searchParams: Promise<{ program?: string | string[];page?:string;pageSize?:string;q?:string }> }) {
  const search=await searchParams;
  const query=new URLSearchParams(Object.entries(search).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));

  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  if (Array.isArray(search.program)) notFound();
  const program = query.get('program');
  if (program) {
    let history: Awaited<ReturnType<typeof reconRunHistory>>;
    try {
      history = await reconRunHistory(session.user.id, program, paginationInput(query, false));
    } catch (error) {
      if (error instanceof ResearchError && error.status === 404) notFound();
      throw error;
    }
    const liveRun=await prisma.targetReconRun.findFirst({where:{programId:history.program.id,program:{ownerId:session.user.id},status:{in:['QUEUED','RUNNING']}},select:{id:true}});
    return <div className="space-y-6">
      <nav aria-label="Recon navigation" className="flex flex-wrap gap-4 text-sm">
        <Link href="/recon" className="text-brand">Recon Targets</Link>
        <Link href={`/targets/${history.program.id}`} className="text-brand">Back to {history.program.companyName}</Link>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold">Recon history — {history.program.companyName}</h1>
        <p className="text-muted">Recent runs, newest first.</p>
        {history.program.deletingAt && <p role="status">Target pending deletion.</p>}
      </div>
      <TargetReconActions programId={history.program.id} running={Boolean(liveRun)} disabled={!!history.program.deletingAt}/>
      <CollectionPager path="/recon" query={query.toString()} {...history} label="Recon history pages" noun="runs"/>
      {!history.items.length ? <p>No Recon runs recorded. <Link className="text-brand" href={`/scopes?target=${history.program.id}`}>Configure Scope</Link> before starting.</p> :
        <div className="ui-table-scroll overflow-x-auto rounded border border-border" tabIndex={0} aria-label="Recon history table" role="region">
          <table className="ui-inventory w-full text-left text-sm">
            <caption className="sr-only">Retained Recon runs ordered by date and unique run ID</caption>
            <thead><tr className="border-b border-border">
              {['Last run (UTC)', 'State', 'Executions'].map(h => <th key={h} scope="col" className="p-3">{h}</th>)}
            </tr></thead>
            <tbody>{history.items.map(run => {
              const view = reconOverview(run);
              return <tr key={run.id} className="border-b border-border last:border-0">
                <td data-label="Last run" className="p-3">
                  <Link href={`/recon/runs/${run.id}?historyPage=${history.page}&historyPageSize=${history.pageSize}`} className="text-brand">
                    <time dateTime={run.createdAt.toISOString()}>{stamp(run.createdAt)}</time>

                  </Link>
                </td>
                <td data-label="State" className="p-3">
                  <Badge tone={badgeTone[view.tone]}>{view.label}</Badge>

                </td>
                <td data-label="Executions" className="p-3">{run._count.scans}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </div>;
  }

  const collection=await programCollection(session.user.id,paginationInput(query,false));
  const programs=collection.items;
  // One representative Scope asset per visible program, with bounded
  // relation reads. This is display context; execution rechecks current policy.
  const assetRows=await prisma.bountyProgram.findMany({where:{id:{in:programs.map(p=>p.id)},ownerId:session.user.id},select:{id:true,scopeAssets:{where:{active:true},orderBy:[{assetValue:'asc'},{normalizedValue:'asc'},{id:'asc'}],take:1,select:{normalizedValue:true}}}});
  const firstAsset=new Map(assetRows.map(p=>[p.id,p.scopeAssets[0]?.normalizedValue]));

  const rows = programs.map(program => ({
    ...program,
    assets: program._count.scopeAssets,
    asset: firstAsset.get(program.id),
    run: program.reconRuns[0] ?? null,
    view: reconOverview(program.reconRuns[0] ?? null),
  }));

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Recon</h1>
        <p className="text-muted">Latest Recon by target.</p>
      </div>

    </div>

    <form action="/recon" className="flex flex-wrap gap-3"><label>Search Targets<input name="q" defaultValue={search.q??''} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="pageSize" value={collection.pageSize}/><button type="submit" className="ui-btn">Search</button></form>
    <CollectionPager path="/recon" query={query.toString()} {...collection}/>
    {!rows.length && <p>No matching Targets. <Link href="/targets" className="text-brand">Create a Target</Link> to authorize assets and start Recon.</p>}

    {rows.length > 0 && <div className="ui-table-scroll overflow-x-auto rounded border border-border" tabIndex={0} role="region" aria-label="Targets and their latest Recon result">
      <table className="ui-inventory w-full text-left text-sm">
        <caption className="sr-only">Targets and their latest Recon result</caption>
        <thead>
          <tr className="border-b border-border">
            {['Target', 'Asset / host', 'State', 'Last run', ''].map(heading => <th key={heading} scope="col" className="p-3 font-medium">{heading}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <tr key={row.id} className="border-b border-border last:border-0">
            <td data-label="Target" className="p-3"><div>
              <Link className="font-medium text-brand" href={`/targets/${row.id}`}>{row.companyName}</Link>
              <p className="text-xs text-muted">{platformLabel(row.platform)}{row.deletingAt ? ' · pending deletion' : ''}</p>
            </div></td>
            <td data-label="Asset / host" className="p-3"><div><span className="break-all font-mono text-xs">{row.asset??'No assets'}</span>{row.assets>1&&<p className="text-xs text-muted">+{row.assets-1} more</p>}</div></td>
            <td data-label="State" className="p-3">
              <Badge tone={badgeTone[row.view.tone]}>{row.view.label}</Badge>

            </td>
            <td data-label="Last run" className="p-3 text-muted">{row.run ? <time dateTime={row.run.createdAt.toISOString()}>{stamp(row.run.createdAt)}</time> : '—'}</td>
            <td data-label="Action" className="p-3">
              <Link className="font-medium text-brand" href={row.run?`/recon/runs/${row.run.id}`:`/recon?program=${row.id}`} aria-label={row.run?`Open latest Recon run for ${row.companyName}`:`Open Recon for ${row.companyName}`}>Open</Link>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}


  </div>;
}
