import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { captureAssessmentSnapshot, type AssessmentMode, type AssessmentSourceInput } from '@/lib/assessment';
import { lockOwnedProgram } from './scopeAssets';
import { ResearchError } from './research/workspace';

/** Caller holds the owned program lock (FOR SHARE or FOR UPDATE) until publication. */
export async function captureProgramAssessment(tx: Prisma.TransactionClient, programId: string) {
  const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id: programId }, select: { assessmentMode: true, assessmentSources: { where: { active: true }, orderBy: { id: 'asc' } } } });
  return captureAssessmentSnapshot(program);
}
const effective = <T extends { active: boolean }>(source: T, mode: AssessmentMode) => ({ ...source, effective: mode === 'WHITE_BOX' && source.active });
export async function listAssessmentSources(userId: string, programId: string) {
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    const sources = await tx.assessmentSource.findMany({ where: { programId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { assessmentMode: program.assessmentMode, sources: sources.map(source => effective(source, program.assessmentMode)) };
  });
}
export async function setAssessmentMode(userId: string, programId: string, mode: AssessmentMode, confirmed?: boolean) {
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    if (program.assessmentMode !== mode && !confirmed) throw new ResearchError('ASSESSMENT_CONFIRMATION_REQUIRED: Confirm the assessment mode change; network scope remains unchanged.', 409);
    // updatedAt is the existing *network* policy identity for legacy Research.
    // An advisory configuration edit must not revoke or rewrite that policy.
    await tx.bountyProgram.update({ where: { id: programId }, data: { assessmentMode: mode, updatedAt: program.updatedAt } });
    return { assessmentMode: mode };
  });
}
export async function createAssessmentSource(userId: string, programId: string, input: AssessmentSourceInput) {
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    if (await tx.assessmentSource.count({ where: { programId } }) >= 100) throw new ResearchError('At most 100 source scopes can be registered per Target', 422);
    return { source: effective(await tx.assessmentSource.create({ data: { ...input, programId } }), program.assessmentMode) };
  });
}
export async function editAssessmentSource(userId: string, programId: string, sourceId: string, input: Partial<AssessmentSourceInput>) {
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    if (!await tx.assessmentSource.findFirst({ where: { id: sourceId, programId } })) throw new ResearchError('Source not found', 404);
    return { source: effective(await tx.assessmentSource.update({ where: { id: sourceId }, data: input }), program.assessmentMode) };
  });
}
