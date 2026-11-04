import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assessmentSourceSchema } from '@/lib/assessment';
import { createAssessmentSource, listAssessmentSources } from '@/server/assessment';
import { assessmentRequestBody, assessmentError } from '@/server/assessmentRequest';

type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try { return Response.json(await listAssessmentSources(session.user.id, (await params).id), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return assessmentError(error); }
}
export async function POST(req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const input = assessmentSourceSchema.safeParse(await assessmentRequestBody(req));
    if (!input.success) return Response.json({ error: input.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }, { status: 400 });
    return Response.json(await createAssessmentSource(session.user.id, (await params).id, input.data), { status: 201 });
  } catch (error) { return assessmentError(error); }
}
