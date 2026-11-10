import { prisma } from '../src/lib/prisma';
import { automationSourceText, findAutomationProhibition, mentionsAutomation } from '../src/lib/automationProhibition.mjs';
try {
  const programs = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.bountyProgram.findMany({ select: { id: true, companyName: true, rulesOfEngagement: true,
      executionPolicies: { orderBy: { version: 'desc' }, take: 1, select: { policy: true } },
      targets: { select: { scope: { select: { rulesOfEngagement: true, scopeDetails: true, outOfScope: true } } } },
    } });
  });
  const candidates = [];
  for (const program of programs) {
    const policy = program.executionPolicies[0]?.policy as { sourceSnapshot?: object } | undefined;
    const text = [automationSourceText(program.rulesOfEngagement, policy?.sourceSnapshot),
      ...program.targets.flatMap(target => [target.scope.rulesOfEngagement, target.scope.scopeDetails, target.scope.outOfScope])].filter(Boolean).join('\n');
    const mentions = [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(mentionsAutomation))];
    if (mentions.length && !findAutomationProhibition(text)) candidates.push({ id: program.id, name: program.companyName, mentions });
  }
  process.stdout.write(JSON.stringify({ targetsInspected: programs.length, candidates }, null, 2) + '\n');
} finally { await prisma.$disconnect(); }
