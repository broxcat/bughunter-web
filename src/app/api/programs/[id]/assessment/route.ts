import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assessmentModeChangeSchema } from '@/lib/assessment';
import { setAssessmentMode } from '@/server/assessment';
import { assessmentRequestBody, assessmentError } from '@/server/assessmentRequest';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const input = assessmentModeChangeSchema.safeParse(await assessmentRequestBody(req));
    if (!input.success) return Response.json({ error: 'Select Black-box or White-box and confirm the change.' }, { status: 400 });
    return Response.json(await setAssessmentMode(session.user.id, (await params).id, input.data.assessmentMode, input.data.confirmed));
  } catch (error) { return assessmentError(error); }
}
