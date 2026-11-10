import Link from 'next/link';
import { auth } from '@/lib/auth';
import { platformLabel } from '@/lib/platformPresentation';
import { programCollection } from '@/server/programCollection';
import CampaignLiveRefresh from '@/components/CampaignLiveRefresh';
import { CampaignState } from '@/components/TargetCampaignView';

export default async function TargetsPage({ searchParams }: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const ownerId = (await auth())?.user?.id;
  if (!ownerId) return null;
  const search = await searchParams;
  const data = await programCollection(ownerId, { page: 1, pageSize: 100, q: '' });
  const active = data.items.filter(program => program.campaign.activity.active)
    .map(program => ({ id: program.id, ...program.campaign.activity }));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1>Targets</h1><Link className="ui-btn" data-variant="primary" href="/targets/new">Create target</Link>
    </div>
    {search.deleted === '1' && <p role="status">Target deleted.</p>}
    {data.items.length > 0 && <div className="ui-table-scroll" role="region" aria-label="Program inventory" tabIndex={0}>
      <table className="ui-inventory ui-targets w-full text-left text-sm">
        <caption className="sr-only">Program inventory</caption>
        <thead><tr>{['Target', 'Platform', 'Scope', 'Current stage', 'State', ''].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.items.map(program => <tr key={program.id}>
          <td data-label="Target"><span className="font-medium">{program.companyName}</span>
            {program.deletingAt && <p role="status" className="text-xs text-muted">Deletion pending</p>}
          </td>
          <td data-label="Platform" className="text-muted">{platformLabel(program.platform)}</td>
          <td data-label="Scope">{program._count.scopeAssets} assets</td>
          <td data-label="Current stage">{program.campaign.current.stage}</td>
          <td data-label="State"><CampaignState state={program.campaign.current.state} /></td>
          <td data-label="Action"><Link prefetch={false} className="font-medium text-brand" aria-label={'Open ' + program.companyName} href={'/targets/' + program.id}>Open</Link></td>
        </tr>)}</tbody>
      </table>
    </div>}
    {!data.items.length && <p className="text-sm text-muted">No targets yet. Create a target to define its scope.</p>}
    {active.length > 0 && <CampaignLiveRefresh activity={active} />}
  </div>;
}
