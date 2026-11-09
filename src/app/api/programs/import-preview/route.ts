
import { auth } from '@/lib/auth';
import { IMPORT_PLATFORMS } from '@/lib/platformConnections';
import { foreignOrigin } from '@/lib/requestOrigin';
import { previewProgram } from '@/server/programImport/preview';
import { ImportUnavailable } from '@/server/programImport/types';
import { z } from 'zod';

const input = z.strictObject({
  url: z.string().trim().min(1).max(2048),
  platform: z.enum([...IMPORT_PLATFORMS, 'PRIVATE', 'OTHER']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
});
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid program URL or platform' }, { status: 400 });
  const { platform, url, visibility } = parsed.data;
  if (platform === 'PRIVATE' || platform === 'OTHER') return Response.json({ status: 'MANUAL', reason: 'manual' }, { headers: privateHeaders });
  try {
    return Response.json({ status: 'PREVIEW', preview: await previewProgram(userId, { url, platform, visibility }) }, { headers: privateHeaders });
  } catch (error) {
    const reason = error instanceof ImportUnavailable ? error.reason : 'manual';
    if (reason === 'rate_limited' && error instanceof ImportUnavailable) {
      return Response.json({ status: 'MANUAL', reason }, { status: 429, headers: { ...privateHeaders, 'Retry-After': String(error.retryAfter ?? 60) } });
    }
    return Response.json({ status: 'MANUAL', reason }, {
      status: reason === 'temporarily_unavailable' ? 503 : 200,
      headers: privateHeaders,
    });
  }
}
