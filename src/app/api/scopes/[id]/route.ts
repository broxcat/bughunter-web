import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  POLICY_TEXT_FIELDS,
  nullIfBlank,
  updatePolicySchema,
} from "@/lib/scopePolicy";

// PATCH /api/scopes/[id] — edit the informational program-policy fields only.
// hostPattern, justification and status are deliberately NOT editable here: they
// are the authorization attestation, and changing them after approval would
// silently change what was authorized. (Zod strips unknown keys, so a body that
// includes them has them ignored.)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updatePolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const scope = await prisma.scope.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!scope) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, string | null | undefined> = {};
  for (const field of POLICY_TEXT_FIELDS) {
    const v = nullIfBlank(parsed.data[field]);
    if (v !== undefined) data[field] = v;
  }
  if (parsed.data.platform !== undefined) data.platform = parsed.data.platform;

  const updated = await prisma.scope.update({
    where: { id: scope.id },
    data,
  });

  return NextResponse.json(updated);
}
