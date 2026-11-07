import { foreignOrigin } from '@/lib/requestOrigin';
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { programSchema } from "@/lib/bountyProgram";
import { paginationInput } from '@/lib/pagination';
import { programCollection } from '@/server/programCollection';

export async function GET(request?: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params=new URLSearchParams(request?new URL(request.url).search:'');
  if(params.get('options')==='1')return NextResponse.json(await prisma.bountyProgram.findMany({where:{ownerId:session.user.id},select:{id:true,companyName:true},orderBy:[{companyName:'asc'},{id:'asc'}]}),{headers:{'Cache-Control':'private, no-store'}});
  if(params.has('page')||params.has('pageSize')){
    let input;try{input=paginationInput(params);}catch{return NextResponse.json({error:'Use a positive page and pageSize between 1 and 100'},{status:400});}
    return NextResponse.json(await programCollection(session.user.id,input),{headers:{'Cache-Control':'private, no-store'}});
  }
  return NextResponse.json(await prisma.bountyProgram.findMany({
    where: { ownerId: session.user.id }, orderBy: [{ companyName: "asc" },{id:'asc'}],
    include: { _count: { select: { scopeAssets: { where: { active: true } } } }, targets: { where: { active: true, contextOnly: false, userId: session.user.id }, orderBy: { host: "asc" } } },
  }));
}
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = programSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const { scopeHosts, ...data } = parsed.data;
  data.scopeRules = [...new Set([...data.scopeRules, ...scopeHosts])];
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
