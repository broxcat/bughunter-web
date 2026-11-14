import { routeIdSchema } from '@/lib/routeParams';
import { withApiBoundary } from '@/lib/apiBoundary';
import {paginationInput,paginationBounds} from '@/lib/pagination';
import {Prisma} from '@prisma/client';
import { foreignOrigin } from '@/lib/requestOrigin';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createTargetSchema = z.object({
  scopeId: routeIdSchema,
  host: z.string().trim().min(1, "host is required"),
  label: z.string().trim().min(1).optional(),
});

/**
 * Accept either a full URL (https://host.tld/path) or a bare host, and normalize
 * to the bare host the way subfinder expects, keeping the original scheme so the
 * URL can be rebuilt correctly instead of assuming https.
 *   "https://ex.com/a" -> { host: "ex.com", scheme: "https" }
 *   "ex.com:8443"      -> { host: "ex.com:8443", scheme: null }
 * The bare host keeps a :port if present (URL tools need it; subfinder/nmap strip
 * it). Returns null host if nothing usable remains.
 */
function normalizeTargetInput(input: string): { host: string; scheme: string | null } {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      return { host: u.host.toLowerCase(), scheme: u.protocol.replace(":", "").toLowerCase() };
    } catch {
      /* fall through to bare parsing */
    }
  }
  const host = trimmed
    .replace(/^\/+/, "") // stray leading slashes
    .split(/[/?#]/)[0] // drop any path/query/fragment
    .replace(/\/+$/, "")
    .toLowerCase();
  return { host, scheme: null };
}

// GET /api/targets — list the signed-in user's targets (with their scope).
 async function handleGET(request?:Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query=new URLSearchParams(request?new URL(request.url).search:'');
  if(query.has('page')||query.has('pageSize')){
    let input;try{input=paginationInput(query);}catch{return NextResponse.json({error:'Invalid page or pageSize'},{status:400});}
    const where={userId:session.user.id,contextOnly:false,...(query.get('legacy')==='1'?{programId:null}:{}),...(input.q?{host:{contains:input.q,mode:'insensitive' as const}}:{})};
    const result=await prisma.$transaction(async tx=>{
      const bounds=paginationBounds(input,await tx.target.count({where}));
      const items=await tx.target.findMany({where,orderBy:[{host:'asc'},{id:'asc'}],skip:bounds.skip,take:bounds.pageSize,select:{id:true,host:true,programId:true}});
      return{...bounds,items};
    },{isolationLevel:'RepeatableRead'});
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }
  const targets = await prisma.target.findMany({
    where: { userId: session.user.id, contextOnly: false },
    orderBy: [{createdAt:"desc"},{id:"desc"}],
    include: { scope: true },
  });

  return NextResponse.json(targets);
}

// POST /api/targets — create a target. Rejected unless its linked Scope belongs
// to the user AND is APPROVED. This is the first of the two authorization checks
// (the worker re-checks APPROVED again just before spawning any tool).
 async function handlePOST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const scope = await prisma.scope.findFirst({
    where: { id: parsed.data.scopeId, userId: session.user.id },
  });
  if (!scope) {
    return NextResponse.json(
      { error: "Scope not found or not owned by you" },
      { status: 400 },
    );
  }
  if (scope.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Scope must be APPROVED before adding a target" },
      { status: 400 },
    );
  }

  const { host, scheme } = normalizeTargetInput(parsed.data.host);
  if (!host) {
    return NextResponse.json(
      { error: "Could not parse a host from the input" },
      { status: 400 },
    );
  }

  const target = await prisma.target.create({
    data: {
      userId: session.user.id,
      scopeId: scope.id,
      host,
      scheme,
      label: parsed.data.label,
    },
   }).catch(error=>{if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2003')return null;throw error;});
  if(!target)return NextResponse.json({error:'Scope not found or not owned by you'},{status:400});

  return NextResponse.json(target, { status: 201 });
}

export const GET = withApiBoundary(handleGET, []);
export const POST = withApiBoundary(handlePOST, []);
