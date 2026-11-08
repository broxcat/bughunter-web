import { z } from 'zod';
import { hasReproducibleProof, type ResearchData } from './hypotheses';

export const REVIEW_VERDICTS = ['SUPPORTED', 'REFUTED', 'INCONCLUSIVE'] as const;

const reviewFields = {
  reason: z.string().trim().min(20).max(1200),
};
const positiveFields = {
  ...reviewFields,
  testId: z.string().regex(/^T-[0-9]{3,6}$/),
  accessContext: z.string().trim().min(3).max(120),
  reproducedInFreshContext: z.literal(true),
  impactDemonstrated: z.literal(true),
  minimumPrivilegesVerified: z.literal(true),
};
const revision = z.number().int().min(1).max(2147483647);
export const researchReviewInput = z.discriminatedUnion('verdict', [
  z.strictObject({ expectedRevision: revision, verdict: z.literal('SUPPORTED'), ...positiveFields }),
  z.strictObject({ expectedRevision: revision, verdict: z.enum(['REFUTED', 'INCONCLUSIVE']), ...reviewFields }),
]);
export const savedResearchReview = z.discriminatedUnion('verdict', [
  z.strictObject({ reviewedAt: z.iso.datetime(), verdict: z.literal('SUPPORTED'), ...positiveFields }),
  z.strictObject({ reviewedAt: z.iso.datetime(), verdict: z.enum(['REFUTED', 'INCONCLUSIVE']), ...reviewFields }),
]);
export type ResearchReviewInput = z.infer<typeof researchReviewInput>;
export type SavedResearchReview = z.infer<typeof savedResearchReview>;

export function reproducibleResearchTests(proof: ResearchData) {
  return proof.tests.filter(test => hasReproducibleProof({ ...proof, tests: [test] }));
}
