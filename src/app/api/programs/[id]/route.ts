import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { programUpdateSchema } from "@/lib/bountyProgram";

type Params = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId: session.user.id }, include: { targets: { where: { active: true }, orderBy: { host: "asc" } } } });
  return program ? NextResponse.json(program) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = programUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId: session.user.id } });
  if (!program) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await prisma.bountyProgram.update({ where: { id }, data: parsed.data }));
}
