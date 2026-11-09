import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function TargetDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ownerId = (await auth())?.user?.id;
  if (!ownerId) return null;
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId }, select: { companyName: true, programUrl: true } });
  if (!program) notFound();
  const root = '/targets/' + id;
  const links = [
    ['Target settings', root + '/settings', 'Scope, execution policy and test accounts'],
    ['Scope assets', '/scopes?target=' + id, 'Asset inventory and authorized boundaries'],
    ['Recon history', '/recon?program=' + id, 'Runs, artifacts and logs'],
    ['Research details', '/research?program=' + id + '&view=details', 'Workspaces, plans, coverage and terminal'],
    ['Findings', root + '/findings', 'Evidence and reporting'],
    ['Hunt history', '/hunt', 'Archived Hunt runs'],
  ];
  return <div className="max-w-3xl space-y-5">
    <Link href={root} className="text-sm text-brand">← {program.companyName}</Link>
    <h1 className="text-2xl font-semibold">Target details</h1>
    {program.programUrl && <a href={program.programUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-brand underline">Open program on platform</a>}
    <ul className="divide-y divide-border rounded border border-border bg-surface px-4">
      {links.map(([label, href, description]) => <li key={label} className="py-3">
        <Link href={href} className="font-medium text-brand">{label}</Link>
        <p className="text-sm text-muted">{description}</p>
      </li>)}
    </ul>
  </div>;
}
