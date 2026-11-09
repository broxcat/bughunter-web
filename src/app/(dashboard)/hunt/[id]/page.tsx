import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LegacyHuntReport from "@/components/LegacyHuntReport";
export default async function HuntRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const { id } = await params;
  const run = await prisma.scanRun.findFirst({ where: { id, type: "HUNT", target: { userId: session.user.id, OR: [{ program: null }, { program: { ownerId: session.user.id } }] } }, select: { id: true, status: true, createdAt: true, huntReport: true, huntSnapshot: true, target: { select: { id: true, host: true } } } });
  if (!run) notFound();
  return <div className="space-y-6"><Link href="/hunt" className="text-brand">← Legacy hunt history</Link><h1 className="text-2xl">Legacy hunt · {run.target.host}</h1><p>{run.status} · {run.createdAt.toISOString()}</p><Link className="text-brand" href={`/targets/${run.target.id}/findings`}>Open historical findings</Link><LegacyHuntReport report={run.huntReport} snapshot={run.huntSnapshot} /></div>;
}
