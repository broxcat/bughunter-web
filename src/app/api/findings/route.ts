import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { suggestCwe } from "@/lib/cwe";
import { loadOobHitsByToken } from "@/lib/oobHits";
import {
  cvssColumns,
  cvssVectorField,
  cweField,
  reportTextField,
} from "@/lib/findingClassification";

const createFindingSchema = z.object({
  targetId: z.string().trim().min(1, "targetId is required"),
  scanRunId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1, "title is required"),
  vulnClass: z.string().trim().min(1).optional(),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  description: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
  evidence: z.string().trim().min(1).optional(),
  cwe: cweField.optional(),
  cvssVector: cvssVectorField.optional(),
  impact: reportTextField.min(1).optional(),
  remediation: reportTextField.min(1).optional(),
});

// GET /api/findings?targetId=... — list findings for one owned target.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetId = req.nextUrl.searchParams.get("targetId");
  if (!targetId) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }

  const target = await prisma.target.findFirst({
    where: { id: targetId, userId: session.user.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const findings = await prisma.finding.findMany({
    where: { targetId: target.id },
    orderBy: { createdAt: "desc" },
  });

  // Attach correlated out-of-band callbacks (Phase 5). A finding's oobToken
  // matches OobHit.token (0, 1, or many hits). One batched query for all tokens
  // on this page, then group in memory — no N+1.
  const tokens = findings
    .map((f) => f.oobToken)
    .filter((t): t is string => t !== null && t !== undefined);

  const hitsByToken = await loadOobHitsByToken(tokens);

  const withHits = findings.map((f) => ({
    ...f,
    oobHits: f.oobToken ? (hitsByToken.get(f.oobToken) ?? []) : [],
  }));

  return NextResponse.json(withHits);
}

// POST /api/findings — create a finding on an owned target. Starts UNVALIDATED;
// the gate route decides PASSED/KILLED.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createFindingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const target = await prisma.target.findFirst({
    where: { id: parsed.data.targetId, userId: session.user.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  // If a scanRun is referenced, it must belong to this target.
  if (parsed.data.scanRunId) {
    const run = await prisma.scanRun.findFirst({
      where: { id: parsed.data.scanRunId, targetId: target.id },
      select: { id: true },
    });
    if (!run) {
      return NextResponse.json(
        { error: "scanRun not found on this target" },
        { status: 400 },
      );
    }
  }

  const finding = await prisma.finding.create({
    data: {
      targetId: target.id,
      scanRunId: parsed.data.scanRunId,
      title: parsed.data.title,
      vulnClass: parsed.data.vulnClass,
      severity: parsed.data.severity ?? "INFO",
      description: parsed.data.description,
      location: parsed.data.location,
      evidence: parsed.data.evidence,
      cwe: parsed.data.cwe ?? suggestCwe(parsed.data.vulnClass) ?? undefined,
      ...cvssColumns(parsed.data.cvssVector),
      impact: parsed.data.impact,
      remediation: parsed.data.remediation,
      gateStatus: "UNVALIDATED",
    },
  });

  return NextResponse.json(finding, { status: 201 });
}
