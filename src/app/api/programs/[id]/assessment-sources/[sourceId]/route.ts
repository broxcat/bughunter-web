import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assessmentSourceUpdateSchema } from '@/lib/assessment';
import { editAssessmentSource } from '@/server/assessment';
import { assessmentRequestBody, assessmentError } from '@/server/assessmentRequest';

type Context = { params: Promise<{ id: string; sourceId: string }> };
export async function PATCH(req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const input = assessmentSourceUpdateSchema.safeParse(await assessmentRequestBody(req));
    if (!input.success) return Response.json({ error: input.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }, { status: 400 });
    const { id, sourceId } = await params;
    return Response.json(await editAssessmentSource(session.user.id, id, sourceId, input.data));
  } catch (error) { return assessmentError(error); }
}
export async function DELETE(req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { id, sourceId } = await params;
    return Response.json(await editAssessmentSource(session.user.id, id, sourceId, { active: false }));
  } catch (error) { return assessmentError(error); }
}
