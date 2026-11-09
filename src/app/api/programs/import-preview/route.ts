import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { intakeInput } from '@/lib/programIntake';
import { rateLimit } from '@/lib/rateLimit';
import { AiConfigurationError } from '@/server/brain/config';
import { campaignSourceFromIntake, extractProgram, INVALID_EXTRACTION, NO_AI } from '@/server/programImport/intake';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const ownerId = (await auth())?.user?.id;
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (foreignOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const input = intakeInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'Enter a program URL or paste the complete program Markdown (up to 64,000 characters).' }, { status: 400, headers });
  const quota = await rateLimit('rl:program-intake:' + ownerId, 8, 60);
  if (quota.status !== 'ALLOWED') return Response.json({ error: 'Program extraction is temporarily unavailable. Try again or fill in the form manually.' },
    { status: quota.status === 'BLOCKED' ? 429 : 503, headers });
  try {
    const preview = await extractProgram(ownerId, input.data, request.signal);
    return Response.json({ preview, source: campaignSourceFromIntake(preview) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof AiConfigurationError || message === NO_AI) {
      return Response.json({ error: NO_AI, settings: true }, { status: 409, headers });
    }
    const safe = message === INVALID_EXTRACTION || message.startsWith('The YesWeHack') || message.startsWith('This public program page') ||
      message.startsWith('This URL does not match') || message.startsWith('Public program downloads') ||
      message.startsWith('The selected AI provider');
    return Response.json({ error: safe ? message : 'Program extraction failed. Fill in the form manually or try again.' }, { status: 422, headers });
  }
}
