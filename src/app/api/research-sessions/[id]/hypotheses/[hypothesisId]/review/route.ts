import { researchReviewInput } from '@/lib/research/humanReview';
import { coverageBody, coverageRequest } from '@/server/research/coverageRequest';
import { hypothesisErrorResponse } from '@/server/research/hypothesisResponse';
import { recordResearchReview } from '@/server/research/promotion';
import { ResearchError } from '@/server/research/workspace';

export async function POST(req: Request, { params }: { params: Promise<{ id: string; hypothesisId: string }> }) {
  try {
    const userId = await coverageRequest(req, true);
    const { id, hypothesisId } = await params;
    if (![id, hypothesisId].every(value => /^[A-Za-z0-9_-]{1,100}$/.test(value))) return Response.json({ error: 'Not found' }, { status: 404 });
    const parsed = researchReviewInput.safeParse(await coverageBody(req));
    if (!parsed.success) throw new ResearchError('Choose a verdict and provide the reviewed revision and rationale. A supported verdict requires all evidence checks.', 400);
    const decision = await recordResearchReview(id, hypothesisId, userId, parsed.data);
    return Response.json(decision, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ResearchError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    return hypothesisErrorResponse(error);
  }
}
