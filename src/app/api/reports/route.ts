import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadOobHitsByToken } from "@/lib/oobHits";
import { renderReport, type ReportFinding } from "@/lib/reportTemplates";

const createReportSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  platform: z.enum([
    "HACKERONE",
    "BUGCROWD",
    "INTIGRITI",
    "YESWEHACK",
    "IMMUNEFI",
    "GENERIC",
  ]),
  findingIds: z.array(z.string().trim().min(1)).min(1, "at least one finding is required"),
});

// GET /api/reports — list the user's reports.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reports = await prisma.report.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(reports);
}

// POST /api/reports — NON-NEGOTIABLE: a report may include ONLY findings whose
// gateStatus === "PASSED" and that the user owns. Any violation rejects the
// whole request (400); nothing is written.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const requestedIds = Array.from(new Set(parsed.data.findingIds));

  // Fetch only the user's own findings among those requested.
  const findings = await prisma.finding.findMany({
    where: { id: { in: requestedIds }, target: { userId: session.user.id } },
  });

  // Every requested id must resolve to an owned finding.
  if (findings.length !== requestedIds.length) {
    return NextResponse.json(
      { error: "One or more findings were not found or are not owned by you" },
      { status: 400 },
    );
  }

  // Every included finding must have PASSED the gate. No exceptions.
  const notPassed = findings.filter((f) => f.gateStatus !== "PASSED");
  if (notPassed.length > 0) {
    return NextResponse.json(
      {
        error: "A report may only include findings that PASSED the 7-Question Gate",
        offending: notPassed.map((f) => ({ id: f.id, gateStatus: f.gateStatus })),
      },
      { status: 400 },
    );
  }

  // SSRF proof of concept includes the correlated out-of-band callbacks.
  const hitsByToken = await loadOobHitsByToken(
    findings.map((f) => f.oobToken).filter((t): t is string => !!t),
  );

  // Render in the requested-id order for a stable report.
  const byId = new Map(findings.map((f) => [f.id, f]));
  const ordered: ReportFinding[] = requestedIds.map((fid) => {
    const f = byId.get(fid)!;
    return {
      title: f.title,
      vulnClass: f.vulnClass,
      severity: f.severity,
      description: f.description,
      evidence: f.evidence,
      location: f.location,
      cwe: f.cwe,
      cvssVector: f.cvssVector,
      cvssScore: f.cvssScore,
      impact: f.impact,
      remediation: f.remediation,
      oobHits: f.oobToken ? (hitsByToken.get(f.oobToken) ?? []) : [],
    };
  });

  const markdown = renderReport(parsed.data.platform, {
    title: parsed.data.title,
    findings: ordered,
  });

  // Denormalized link to the report's target. The findings are all owned by the
  // user and, in the per-target report flow, all share one target — so link it
  // when unambiguous, otherwise leave null.
  const targetIds = new Set(findings.map((f) => f.targetId));
  const targetId = targetIds.size === 1 ? findings[0].targetId : null;

  const report = await prisma.report.create({
    data: {
      userId: session.user.id,
      targetId,
      title: parsed.data.title,
      platform: parsed.data.platform,
      markdown,
      items: {
        create: requestedIds.map((findingId) => ({ findingId })),
      },
    },
    include: { items: true },
  });

  return NextResponse.json(report, { status: 201 });
}
