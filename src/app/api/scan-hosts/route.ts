import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scanRejection } from "@/server/execution";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const programs = await prisma.bountyProgram.findMany({ where: { ownerId: session.user.id }, orderBy: { companyName: "asc" },
    include: { targets: { where: { userId: session.user.id, active: true }, orderBy: { host: "asc" }, include: { scope: true } } } });
  return Response.json(programs.map(p => ({ id: p.id, companyName: p.companyName, requiredUserAgent: p.requiredUserAgent,
    hosts: p.targets.filter(t => !scanRejection({ ...t, program: p })).map(t => ({ id: t.id, host: t.host })) })));
}
