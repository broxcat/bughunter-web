import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadReconReportFacts } from "@/server/recon/reportFacts";
import { buildReconReportModel } from "@/lib/reconReportModel";
import ReconDecision from "@/components/ReconDecision";

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const { program } = await searchParams;
  const programs = await prisma.bountyProgram.findMany({
    where: { ownerId: userId, ...(program ? { id: program } : {}) },
    orderBy: { companyName: "asc" },
    select: {
      id: true,
      companyName: true,
      scopeAssets: {
        where: { active: true },
        select: { id: true, normalizedValue: true },
      },
      reconRuns: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true },
      },
      targets: {
        where: { active: true, contextOnly: false },
        select: {
          id: true,
          host: true,
          _count: { select: { findings: true } },
        },
      },
    },
  });
  const history = await prisma.researchSession.findMany({
    where: {
      userId,
      target: { userId, ...(program ? { programId: program } : {}) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, targetHost: true, programName: true },
  });
  return (
    <div className="space-y-6">
      <h1>Manual Research</h1>
      <p>
        Review the authorized hosts and Recon evidence, investigate manually,
        then record findings. Discovered hosts require explicit scope approval
        before testing.
      </p>
      {programs.map(async (p) => (
        <section
          key={p.id}
          className="space-y-4 rounded border border-border p-5"
        >
          <Link className="text-brand" href={"/targets/" + p.id}>
            {p.companyName}
          </Link>
          <h2>Currently in scope</h2>
          <ul>
            {p.scopeAssets.map((a) => (
              <li key={a.id} className="font-mono text-sm">
                {a.normalizedValue}
              </li>
            ))}
          </ul>
          {p.reconRuns[0] && (
            <ReconDecision
              model={buildReconReportModel(
                await loadReconReportFacts(userId, p.reconRuns[0].id),
              )}
            />
          )}
          <ul>
            {p.targets.map((t) => (
              <li key={t.id}>
                <Link
                  className="text-brand"
                  href={"/targets/" + t.id + "/findings"}
                >
                  Record a finding for {t.host}
                </Link>
              </li>
            ))}
          </ul>
          <Link className="ui-btn" href={"/targets/" + p.id + "/findings"}>
            Findings ({p.targets.reduce((n, t) => n + t._count.findings, 0)})
          </Link>
        </section>
      ))}
      <details>
        <summary>Historical Research evidence</summary>
        <ul>
          {history.map((s) => (
            <li key={s.id}>
              <Link href={"/research/history/" + s.id}>
                {s.programName} / {s.targetHost}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
