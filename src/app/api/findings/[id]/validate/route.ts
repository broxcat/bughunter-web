import { withApiBoundary } from '@/lib/apiBoundary';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evidenceReviewSchema, reviewDecision } from "@/lib/evidenceReview";
import {assertResearchTarget,researchTargetSelect} from '@/server/research/workspace';
import {safeFindingText} from "@/server/findingPrivacy";
import {foreignOrigin} from "@/lib/requestOrigin";

/** Evidence review replaces the retired questionnaire, preserving old columns. */
 async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if(foreignOrigin(req))return NextResponse.json({error:'Forbidden'},{status:403});
  const { id } = await params;
  const parsed = evidenceReviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an evidence-review decision" }, { status: 400 });
  const finding = await prisma.finding.findFirst({ where: { id, target: { userId: session.user.id } }, include: { target: {select:researchTargetSelect}, scanRun: { select: { reconCorpus: true } } } });
  if (!finding) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { status, notes } = parsed.data;
  const inScope=(()=>{try{assertResearchTarget(finding.target,session.user.id!);return true;}catch{return false;}})();
  const error = reviewDecision(finding, status, notes, inScope);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const metadata = finding.huntMetadata as { controls?: string[]; evidenceLevel?: string } | null;
  const observations = (() => { try { return JSON.parse(finding.evidence ?? "null"); } catch { return null; } })();
  const controls: string[] = Array.isArray(observations?.controls) ? observations.controls.filter((c: unknown) => typeof c === "string").slice(0, 20).map(safeFindingText) : [];
  const corpus = finding.scanRun?.reconCorpus as { authenticated?: boolean } | null;
  const updated = await prisma.finding.updateMany({
    where: { id, reviewStatus: finding.reviewStatus, updatedAt: finding.updatedAt },
    data: { reviewStatus: status, reviewedAt: status === "EVIDENCE_REVIEW" ? null : new Date(),
      reviewEvidence: { notes: safeFindingText(notes), reproduction: safeFindingText(notes), baseline: controls.filter(c => /BASELINE|AUTHENTICATED.*CONTROL/i.test(c)), probe: { observationAvailable: Boolean(finding.evidence?.trim()) }, control: controls, scope: inScope ? "IN_SCOPE" : "UNAVAILABLE", authContext: corpus?.authenticated === true ? "VERIFIED_SESSION" : corpus?.authenticated === false ? "ANONYMOUS" : "UNKNOWN", scannerEvidenceLevel: metadata?.evidenceLevel ? safeFindingText(metadata.evidenceLevel) : "UNKNOWN", impact: finding.impact ? "Impact section available" : "See reproduction and impact notes" },
      // Compatibility for historical reports/readers; no question answers written.
      gateStatus: status === "CONFIRMED" ? "PASSED" : status === "REJECTED" ? "KILLED" : "UNVALIDATED",
      killedReason: status === "REJECTED" ? safeFindingText(notes) : null,
    },
  });
  if (!updated.count) return NextResponse.json({ error: "This finding changed; reload before reviewing" }, { status: 409 });
  return NextResponse.json({ id, reviewStatus: status });
}

export const POST = withApiBoundary(handlePOST, ["id"]);
