import type { Prisma } from '@prisma/client';
import { captureAssessmentSnapshot, type AssessmentMode, type AssessmentSourceInput } from '@/lib/assessment';
import { ResearchError } from './research/workspace';

/** Current execution policy; historical columns are never rewritten here. */
export async function captureProgramAssessment(tx: Prisma.TransactionClient, programId: string) {
  await tx.bountyProgram.findUniqueOrThrow({where:{id:programId},select:{id:true}});
  return captureAssessmentSnapshot({});
}
const retired = (): never => { throw new ResearchError('White-box assessment configuration is retired', 410); };
export async function listAssessmentSources(...args: [string,string]) { void args; return retired(); }
export async function setAssessmentMode(...args: [string,string,AssessmentMode,boolean?]) { void args; return retired(); }
export async function createAssessmentSource(...args: [string,string,AssessmentSourceInput]) { void args; return retired(); }
export async function editAssessmentSource(...args: [string,string,string,Partial<AssessmentSourceInput>]) { void args; return retired(); }
