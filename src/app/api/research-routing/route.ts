import { AiConfigurationError } from '@/server/brain/config';
import { coverageBody, coverageJson, coverageRequest } from '@/server/research/coverageRequest';
import { getResearchRouting, routingInput, saveResearchRouting } from '@/server/research/harnessRouting';
import { embeddingConfiguration } from '@/server/research/semanticMemory';
import { ResearchError } from '@/server/research/workspace';

function failure(error: unknown) {
  return error instanceof ResearchError || error instanceof AiConfigurationError
    ? coverageJson({ error: error.message }, error.status)
    : coverageJson({ error: 'Research routing unavailable.' }, 503);
}
export async function GET(req: Request) {
  try {
    const userId = await coverageRequest(req);
    return coverageJson({ routing: await getResearchRouting(userId), embeddingsConfigured: Boolean(embeddingConfiguration()) });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const userId = await coverageRequest(req, true);
    const parsed = routingInput.safeParse(await coverageBody(req));
    if (!parsed.success) throw new ResearchError('Select valid saved providers and model names.', 400);
    return coverageJson({ routing: await saveResearchRouting(userId, parsed.data), embeddingsConfigured: Boolean(embeddingConfiguration()) });
  } catch (error) { return failure(error); }
}
