import Link from 'next/link';
import { reconRunHistory } from '@/server/recon/runHistory';
import { ResearchError } from '@/server/research/workspace';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
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
    return <div className="space-y-6">
      <nav aria-label="Recon navigation" className="flex flex-wrap gap-4 text-sm">
        <Link href="/recon" className="text-brand">Recon Targets</Link>
        <Link href={`/targets/${history.program.id}`} className="text-brand">Back to {history.program.companyName}</Link>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold">Recon history — {history.program.companyName}</h1>
        <p className="text-muted">All retained runs, newest first. Historical evidence does not authorize future operations.</p>
        {history.program.deletingAt && <p role="status">Target pending deletion.</p>}
      </div>
      <CollectionPager path="/recon" query={query.toString()} {...history} label="Recon history pages" noun="runs"/>
      {!history.items.length ? <p>No Recon runs recorded. Manage authorized assets and start Recon from the Target.</p> :
        <div className="overflow-x-auto rounded border border-border" tabIndex={0} aria-label="Recon history table">
          <table className="w-full min-w-[540px] text-left text-sm">
            <caption className="sr-only">Retained Recon runs ordered by date and unique run ID</caption>
            <thead><tr className="border-b border-border">
              {['Run date (UTC)', 'Result', 'Recorded executions'].map(h => <th key={h} scope="col" className="p-3">{h}</th>)}
            </tr></thead>
            <tbody>{history.items.map(run => {
              const view = reconOverview(run);
              return <tr key={run.id} className="border-b border-border last:border-0">
                <td className="p-3">
                  <Link href={`/recon/runs/${run.id}?historyPage=${history.page}&historyPageSize=${history.pageSize}`} className="text-brand">
                    <time dateTime={run.createdAt.toISOString()}>{stamp(run.createdAt)}</time>
                    <span className="block font-mono text-xs">{run.id}</span>
                  </Link>
                </td>
                <td className="p-3">
                  <Badge tone={badgeTone[view.tone]}>{view.label}</Badge>
                  {view.detail && <p className="mt-1 max-w-72 text-xs text-muted">{view.detail}</p>}
                </td>
                <td className="p-3">{run._count.scans}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </div>;
  }

  const collection=await programCollection(session.user.id,paginationInput(query,false));
  const programs=collection.items;

  const rows = programs.map(program => ({
    ...program,
    assets: program._count.scopeAssets,
    run: program.reconRuns[0] ?? null,
    view: reconOverview(program.reconRuns[0] ?? null),
  }));
  const running = rows.filter(row => row.view.tone === 'active').length;
  const needsAttention = rows.filter(row => row.view.tone === 'danger' || row.view.tone === 'warning').length;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Recon</h1>
        <p className="text-muted">What is authorized, what ran last, and what still needs attention.</p>
      </div>
      <p className="text-sm text-muted" aria-live="polite">
        On this page: {running} running · {needsAttention} need attention
      </p>
    </div>

    <form action="/recon" className="flex flex-wrap gap-3"><label>Search Targets<input name="q" defaultValue={search.q??''} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="pageSize" value={collection.pageSize}/><button type="submit" className="ui-btn">Search</button></form>
    <CollectionPager path="/recon" query={query.toString()} {...collection}/>
    {!rows.length && <p>No matching Targets. <Link href="/targets" className="text-brand">Create a Target</Link> to authorize assets and start Recon.</p>}

    {rows.length > 0 && <div className="overflow-x-auto rounded border border-border">
      <table className="w-full min-w-[680px] text-left text-sm">
        <caption className="sr-only">Targets with their authorized asset count and latest Recon result</caption>
        <thead>
          <tr className="border-b border-border">
            {['Target', 'Authorized assets', 'Latest Recon', 'Last run', ''].map(heading => <th key={heading} scope="col" className="p-3 font-medium">{heading}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <tr key={row.id} className="border-b border-border last:border-0">
            <td className="p-3">
              <Link className="font-medium text-brand" href={`/targets/${row.id}`}>{row.companyName}</Link>
              <p className="text-xs text-muted">{row.platform ?? 'Private program'}{row.deletingAt ? ' · pending deletion' : ''}</p>
            </td>
            <td className="p-3">{row.assets}</td>
            <td className="p-3">
              <Badge tone={badgeTone[row.view.tone]}>{row.view.label}</Badge>
              {row.view.detail && <p className="mt-1 max-w-72 text-xs text-muted">{row.view.detail}</p>}
            </td>
            <td className="p-3 text-muted">{row.run ? <time dateTime={row.run.createdAt.toISOString()}>{stamp(row.run.createdAt)}</time> : '—'}</td>
            <td className="p-3">
              <div className="flex flex-wrap gap-3">
                {row.run && <Link className="text-brand" href={`/recon/runs/${row.run.id}`} aria-label={`Open latest Recon run for ${row.companyName}`}>Latest run</Link>}
                <Link className="text-brand" href={`/recon?program=${row.id}`} aria-label={`Open Recon history for ${row.companyName}`}>History</Link>
                <Link className="text-muted" href={`/targets/${row.id}?tab=Recon`} aria-label={`Open Recon for ${row.companyName}`}>Target</Link>
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}

    <p className="text-sm text-muted">Recon observations are evidence, not confirmed vulnerabilities. Missing coverage never proves safety.</p>
  </div>;
}
