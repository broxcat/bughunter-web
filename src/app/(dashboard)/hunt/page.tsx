import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export default async function LegacyHuntPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const runs = await prisma.scanRun.findMany({ where: { type: "HUNT", target: { userId: session.user.id, OR: [{ program: null }, { program: { ownerId: session.user.id } }] } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, createdAt: true, target: { select: { host: true } } } });
  return <div className="space-y-5"><h1 className="text-2xl">Legacy Hunt history</h1><p>The vulnerability-family Hunt engine is retired. Existing runs remain read-only.</p><Link href="/research" className="text-brand">Create a Codex Research Workspace →</Link><ul>{runs.map(r => <li key={r.id}><Link className="text-brand" href={`/hunt/${r.id}`}>{r.target.host} · {r.status} · {r.createdAt.toISOString()}</Link></li>)}</ul>{!runs.length && <p>No historical Hunts.</p>}</div>;
}
