import { withApiBoundary } from '@/lib/apiBoundary';
import { coverageBody, coverageJson, coverageRequest } from '@/server/research/coverageRequest';
import { latestResearchStage, runResearchStage, runStageInput, stageInput } from '@/server/research/harness';
import { ResearchError } from '@/server/research/workspace';

export const maxDuration = 90;

function failure(error: unknown) {
  return error instanceof ResearchError
    ? coverageJson({ error: error.message }, error.status)
    : coverageJson({ error: 'Research stage unavailable.' }, 503);
}
 async function handleGET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await coverageRequest(req);
    const { id } = await params;
    const query = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = stageInput.safeParse({ ...query, ...('revision' in query ? { revision: Number(query.revision) } : {}) });
    if (!parsed.success) throw new ResearchError('Invalid Research stage selection.', 400);
    return coverageJson(await latestResearchStage(userId, id, parsed.data));
  } catch (error) { return failure(error); }
}

 async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await coverageRequest(req, true);
    const { id } = await params;
    const parsed = runStageInput.safeParse(await coverageBody(req));
    if (!parsed.success) throw new ResearchError('Invalid Research stage selection.', 400);
    return coverageJson(await runResearchStage(userId, id, parsed.data, req.signal));
  } catch (error) { return failure(error); }
}

export const GET = withApiBoundary(handleGET, ["id"]);
export const POST = withApiBoundary(handlePOST, ["id"]);
