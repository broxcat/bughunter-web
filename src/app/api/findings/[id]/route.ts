import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  cvssColumns,
  cvssVectorField,
  cweField,
  reportTextField,
} from "@/lib/findingClassification";

// null clears a field; omitting it leaves it unchanged. Severity, gateStatus and
// every other column are deliberately not editable here.
const updateSchema = z.object({
  cwe: cweField.nullable().optional(),
  cvssVector: cvssVectorField.nullable().optional(),
  impact: reportTextField.nullable().optional(),
  remediation: reportTextField.nullable().optional(),
});

// PATCH /api/findings/[id] — edit classification (CWE, CVSS v3.1) and the
// manually written Impact / Remediation report sections. The CVSS score is
// recomputed server-side from the vector.
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
  const parsed = updateSchema.safeParse(body);
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

  const { cwe, cvssVector, impact, remediation } = parsed.data;
  const blankToNull = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null || v === "" ? null : v;

  const updated = await prisma.finding.update({
    where: { id: finding.id },
    data: {
      cwe,
      ...cvssColumns(cvssVector),
      impact: blankToNull(impact),
      remediation: blankToNull(remediation),
    },
  });

  return NextResponse.json(updated);
}
