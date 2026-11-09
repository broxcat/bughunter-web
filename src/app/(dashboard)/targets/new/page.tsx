import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import TargetCreateForm from '@/components/TargetCreateForm';

export default async function NewTargetPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const identity = await prisma.hunterIdentity.findUnique({ where: { userId }, select: { userAgent: true } });
  return <div className="space-y-5">
    <Link href="/targets" className="text-sm text-brand">← Targets</Link>
    <h1 className="text-2xl font-semibold">Create target</h1>
    <TargetCreateForm hunterHasUserAgent={Boolean(identity?.userAgent)} />
  </div>;
}
