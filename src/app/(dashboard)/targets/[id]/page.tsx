import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadTargetCampaign } from '@/server/targetCampaign';
import TargetCampaignView from '@/components/TargetCampaignView';

export default async function TargetPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; cleanup?: string }>;
}) {
  const { id } = await params;
  const ownerId = (await auth())?.user?.id;
  if (!ownerId) return null;
  const campaign = await loadTargetCampaign(ownerId, id);
  if (!campaign) {
    if (await prisma.target.findFirst({ where: { id, userId: ownerId }, select: { id: true } })) redirect('/hosts/' + id);
    notFound();
  }
  const query = await searchParams;
  const notice = query.cleanup === 'pending' ? 'Scope was retired. Research cleanup is unconfirmed. Retry from the retired asset.'
    : query.saved === '1' ? 'Target settings saved.' : undefined;
  return <TargetCampaignView {...campaign} notice={notice} />;
}
