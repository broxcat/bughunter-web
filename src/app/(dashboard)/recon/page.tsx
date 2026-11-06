import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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

export default async function ReconPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const { program } = await searchParams;
  // Historical deep links used to forward into the Target workflow tab.
  if (program) redirect(`/targets/${encodeURIComponent(program)}?tab=Recon`);

  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const programs = await prisma.bountyProgram.findMany({
    where: { ownerId: session.user.id },
    orderBy: { companyName: 'asc' },
    select: {
      id: true,
      companyName: true,
      platform: true,
      deletingAt: true,
      _count: { select: { scopeAssets: { where: { active: true } } } },
      reconRuns: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { status: true, outcome: true, createdAt: true },
      },
    },
  });

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
        {running} running · {needsAttention} need attention
      </p>
    </div>

    {!rows.length && <p>No Targets yet. <Link href="/targets" className="text-brand">Create a Target</Link> to authorize assets and start Recon.</p>}

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
              <Link className="text-brand" href={`/targets/${row.id}?tab=Recon`} aria-label={`Open Recon for ${row.companyName}`}>Open</Link>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}

    <p className="text-sm text-muted">Recon observations are evidence, not confirmed vulnerabilities. Missing coverage never proves safety.</p>
  </div>;
}
