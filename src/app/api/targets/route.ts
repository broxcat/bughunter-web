import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createTargetSchema = z.object({
  scopeId: z.string().trim().min(1, "scopeId is required"),
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
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targets = await prisma.target.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { scope: true },
  });

  return NextResponse.json(targets);
}

// POST /api/targets — create a target. Rejected unless its linked Scope belongs
// to the user AND is APPROVED. This is the first of the two authorization checks
// (the worker re-checks APPROVED again just before spawning any tool).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  });

  return NextResponse.json(target, { status: 201 });
}
