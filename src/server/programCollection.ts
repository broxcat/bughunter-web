import { prisma } from '@/lib/prisma';
import { campaignFacts, campaignProgramSelect, campaignView } from './targetCampaign';
import { paginationBounds, type PageRequest } from '@/lib/pagination';

/** Repeatable read keeps count, page rows and campaign state in one snapshot. */
export function programCollection(ownerId: string, input: PageRequest, unpaged = false) {
  return prisma.$transaction(async tx => {
    const where = { ownerId, ...(input.q ? { companyName: { contains: input.q, mode: 'insensitive' as const } } : {}) };
    const bounds = paginationBounds(input, await tx.bountyProgram.count({ where }));
    const items = await tx.bountyProgram.findMany({
      where, orderBy: [{ companyName: 'asc' }, { id: 'asc' }], ...(unpaged ? {} : { skip: bounds.skip, take: bounds.pageSize }),
      select: { ...campaignProgramSelect,
        reconRuns: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, status: true, outcome: true, createdAt: true } } },
    });
    const facts = await campaignFacts(tx, ownerId, items.map(program => program.id));
    return { ...bounds, items: items.map(program => {
      const { id, companyName, platform, deletingAt, _count, reconRuns } = program;
      const { policyBlocker, current, action, activity } = campaignView(program, facts.get(id)!);
      return { id, companyName, platform, deletingAt, _count, reconRuns, policyBlocker, campaign: { current, action, activity } };
    }) };
  }, { isolationLevel: 'RepeatableRead' });
}
