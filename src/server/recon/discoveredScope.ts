import { prisma } from "@/lib/prisma";
import { loadReconReportFacts } from "./reportFacts";
import { buildReconReportModel } from "@/lib/reconReportModel";
import { detectScopeAsset, assetAllowsHost } from "@/lib/scopeAssets";
import { isExcluded } from "@/lib/bountyProgram";
import { storedExecutionPolicySchema } from "@/lib/programExecutionPolicy";
import { currentPolicySelection } from "../programExecutionPolicy";
import { lockOwnedProgram } from "../scopeAssets";
import { ResearchError } from "../research/workspace";

export function scopeCandidate(
  host: string,
  assets: Parameters<typeof assetAllowsHost>[0][],
  exclusions: string[],
) {
  if (
    isExcluded(host, exclusions) ||
    exclusions.some((value) => {
      try {
        return assetAllowsHost(detectScopeAsset(value), host);
      } catch {
        return true;
      }
    })
  )
    return "excluded";
  if (assets.some((a) => assetAllowsHost(a, host))) return "authorized";
  return "candidate";
}
export async function discoveredScopeCandidates(userId: string, runId: string) {
  const run = await prisma.targetReconRun.findFirst({
    where: { id: runId, program: { ownerId: userId } },
    select: { programId: true },
  });
  if (!run) throw new ResearchError("Recon run not found", 404);
  const p = await prisma.bountyProgram.findUniqueOrThrow({
    where: { id: run.programId },
    include: {
      scopeAssets: { where: { active: true } },
      executionPolicies: currentPolicySelection,
    },
  });
  const policy = storedExecutionPolicySchema.safeParse(
    p.executionPolicies[0]?.policy,
  ).data;
  const m = buildReconReportModel(await loadReconReportFacts(userId, runId));
  return m.dns.flatMap((d) => {
    try {
      const a = detectScopeAsset(d.host);
      if (!["DOMAIN", "SUBDOMAIN"].includes(a.format)) return [];
      return [
        {
          host: a.normalizedValue,
          responsive: m.web.responsiveHosts.includes(a.normalizedValue),
          source: d.source,
          state: scopeCandidate(a.normalizedValue, p.scopeAssets, [
            ...p.outOfScope,
            ...(policy?.exclusions ?? []),
          ]),
        },
      ];
    } catch {
      return [];
    }
  });
}
export async function addDiscoveredScope(
  userId: string,
  runId: string,
  hosts: string[],
) {
  const candidates = await discoveredScopeCandidates(userId, runId);
  const run = await prisma.targetReconRun.findFirstOrThrow({
    where: { id: runId, program: { ownerId: userId } },
    select: { programId: true },
  });
  return prisma.$transaction(async (tx) => {
    const program = await lockOwnedProgram(tx, userId, run.programId);
    const policyRow = await tx.programExecutionPolicy.findFirst({
      where: { programId: program.id },
      orderBy: { version: "desc" },
    });
    const policy = storedExecutionPolicySchema.safeParse(
      policyRow?.policy,
    ).data;
    const assets = await tx.scopeAsset.findMany({
      where: { programId: program.id, active: true },
    });
    const rules = new Set(program.scopeRules);
    for (const host of new Set(hosts)) {
      if (!candidates.some((c) => c.host === host))
        throw new ResearchError("Host was not discovered in this run", 422);
      const state = scopeCandidate(host, assets, [
        ...program.outOfScope,
        ...(policy?.exclusions ?? []),
      ]);
      if (state === "excluded")
        throw new ResearchError(
          "Host is out of scope. Update Target settings first.",
          409,
        );
      if (state === "authorized") continue;
      if (assets.length + hosts.length > 1000)
        throw new ResearchError("Scope limit reached", 409);
      rules.add(host);
      const a = detectScopeAsset(host);
      await tx.scopeAsset.upsert({
        where: {
          programId_normalizedValue: {
            programId: program.id,
            normalizedValue: host,
          },
        },
        create: {
          programId: program.id,
          originalValue: host,
          normalizedValue: host,
          format: a.format,
          type: a.inferredType,
          assetValue: "MEDIUM",
        },
        update: { active: true },
      });
    }
    if (rules.size !== program.scopeRules.length)
      await tx.bountyProgram.update({
        where: { id: program.id },
        data: { scopeRules: [...rules] },
      });
  });
}
