
import { prisma } from '@/lib/prisma';
import { hunterIdentitySchema, storedExecutionPolicySchema } from '@/lib/programExecutionPolicy';
import { captureLegacyScopes, convertLegacyExclusions, legacyFreeText } from './legacyPolicySource';
import { programPolicyInclude, type PolicyProgram } from './programExecutionPolicy';

export function draftExecutionPolicy(program: PolicyProgram, exclusions: string[]) {
  const scopes = captureLegacyScopes(program.targets?.map(target => target.scope) ?? [], program.ownerId);
  const programRules = program.rulesOfEngagement ?? null;
  const userAgent = hunterIdentitySchema.shape.userAgent.safeParse(program.requiredUserAgent);
  return storedExecutionPolicySchema.parse({
    reviewState: 'BACKFILL_DRAFT',
    automationAllowed: false,
    requiredUserAgent: userAgent.success ? userAgent.data : null,
    requiredHeaders: [],
    exclusions,
    requestsPerSecond: null,
    maxConcurrency: null,
    forbiddenCategories: [],
    sourceSnapshot: {
      url: program.programUrl ?? null,
      rules: programRules ?? '',
      unrepresentedRules: legacyFreeText(programRules, scopes),
      legacy: { outOfScope: [...program.outOfScope], scopes, programRules },
    },
  });
}

export async function backfillExecutionPolicies(dryRun: boolean) {
  const report = {
    mode: dryRun ? 'dry-run' : 'apply',
    programsProcessed: 0,
    draftsPlanned: 0,
    draftsCreated: 0,
    existingPoliciesKept: 0,
    retiringProgramsSkipped: 0,
    unconvertibleExclusions: [] as { programId: string; index: number; value: string; reason: string }[],
  };

  for (let after: string | undefined;;) {
    const rows = await prisma.bountyProgram.findMany({
      where: after ? { id: { gt: after } } : undefined,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (!rows.length) break;
    for (const { id } of rows) {
      const result = await prisma.$transaction(async tx => {
        if (!dryRun) await tx.$queryRaw`SELECT id FROM "BountyProgram" WHERE id = ${id} FOR UPDATE`;
        const program = await tx.bountyProgram.findUnique({ where: { id }, include: programPolicyInclude });
        if (!program || program.deletingAt) return null;
        const { exclusions, unconvertible } = convertLegacyExclusions(program.outOfScope);
        if (program.executionPolicies.length) return { draft: false, unconvertible };

        if (!dryRun) await tx.programExecutionPolicy.create({ data: { programId: id, version: 1, policy: draftExecutionPolicy(program, exclusions) } });
        return { draft: true, unconvertible };
      });
      if (!result) { report.retiringProgramsSkipped++; continue; }
      report.programsProcessed++;
      if (result.draft) {
        report.draftsPlanned++;
        if (!dryRun) report.draftsCreated++;
      } else report.existingPoliciesKept++;
      report.unconvertibleExclusions.push(...result.unconvertible.map(item => ({ programId: id, ...item })));
    }
    after = rows.at(-1)!.id;
  }
  return report;
}
