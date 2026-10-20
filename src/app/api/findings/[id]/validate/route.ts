import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluateGate, type GateAnswers } from "@/lib/gate";

const validateSchema = z.object({
  answers: z.record(z.string(), z.boolean()),
});

// POST /api/findings/[id]/validate — run the 7-Question Gate. All "yes" ⇒
// PASSED; otherwise KILLED with a reason. The raw answers are persisted as JSON.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = validateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Ownership via the finding's target.
  const finding = await prisma.finding.findFirst({
    where: { id, target: { userId: session.user.id } },
    select: { id: true },
  });
  if (!finding) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const answers: GateAnswers = parsed.data.answers;
  const result = evaluateGate(answers);

  const updated = await prisma.finding.update({
    where: { id: finding.id },
    data: {
      gateStatus: result.status,
      gateAnswers: answers,
      killedReason: result.status === "KILLED" ? result.killedReason : null,
    },
  });

  return NextResponse.json(updated);
}
