import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createScopeSchema = z.object({
  hostPattern: z.string().trim().min(1, "hostPattern is required"),
  programName: z.string().trim().min(1).optional(),
  justification: z.string().trim().min(1).optional(),
});

// GET /api/scopes — list the signed-in user's scopes.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scopes = await prisma.scope.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(scopes);
}

// POST /api/scopes — declare a scope. Always created PENDING; the user approves
// it themselves (the approval is the authorization attestation, never automatic).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createScopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const scope = await prisma.scope.create({
    data: {
      userId: session.user.id,
      hostPattern: parsed.data.hostPattern,
      programName: parsed.data.programName,
      justification: parsed.data.justification,
      status: "PENDING", // never APPROVED on create
    },
  });

  return NextResponse.json(scope, { status: 201 });
}
