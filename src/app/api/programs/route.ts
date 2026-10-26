import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { programSchema } from "@/lib/bountyProgram";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await prisma.bountyProgram.findMany({
    where: { ownerId: session.user.id }, orderBy: { companyName: "asc" },
    include: { targets: { where: { active: true }, orderBy: { host: "asc" } } },
  }));
}
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = programSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const { scopeHosts, ...data } = parsed.data;
  const ownerId = session.user.id;
  const program = await prisma.$transaction(async tx => {
    const p = await tx.bountyProgram.create({ data: { ...data, ownerId } });
    for (const host of scopeHosts) {
      const scope = await tx.scope.create({ data: { userId: ownerId, hostPattern: host, programName: p.companyName, status: "APPROVED" } });
      await tx.target.create({ data: { userId: ownerId, programId: p.id, scopeId: scope.id, host, active: true } });
    }
    return p;
  });
  return NextResponse.json(program, { status: 201 });
}
