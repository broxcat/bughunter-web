import { z } from 'zod';
import { auth } from '@/lib/auth';
import { targetIdentity } from '@/lib/research/terminal';
import { ResearchError } from '@/server/research/workspace';
import { reconPanelState, generateReconSnapshot, reconSnapshotDetails, transmitReconSnapshot } from '@/server/research/reconSnapshots';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: unknown) => json({ error: error instanceof ResearchError ? error.message : 'Recon context unavailable' }, error instanceof ResearchError ? error.status : 503);
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await auth(); if (!user?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const { id } = await params; if (!targetIdentity.safeParse(id).success) return json({ error: 'Not found' }, 404);
  const query = new URL(req.url).searchParams;
  try {
    if (query.has('snapshotId')) {
      const parsed = z.object({ snapshotId: targetIdentity, kind: z.enum(['assets', 'endpoints', 'technologies', 'observations', 'sources']), page: z.coerce.number().int().min(0).max(10000) }).safeParse({ snapshotId: query.get('snapshotId'), kind: query.get('kind'), page: query.get('page') ?? 0 });
      if (!parsed.success) return json({ error: 'Invalid detail selection' }, 400);
      return json(await reconSnapshotDetails(user.user.id, id, parsed.data.snapshotId, parsed.data.kind, parsed.data.page));
    }
    return json(await reconPanelState(user.user.id, id));
  } catch (error) { return fail(error); }
}
const action = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('generate') }),
  z.strictObject({ action: z.literal('transmit'), snapshotId: targetIdentity, provider: z.enum(['codex', 'claude']) }),
]);
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await auth(); if (!user?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(process.env.AUTH_URL!).origin) return json({ error: 'Forbidden' }, 403);
  const { id } = await params; if (!targetIdentity.safeParse(id).success) return json({ error: 'Not found' }, 404);
  if (!req.body) return json({ error: 'Missing action' }, 400);
  const reader = req.body.getReader(); let timer: ReturnType<typeof setTimeout> | undefined;
  let parsed: z.infer<typeof action>;
  try {
    const raw = await Promise.race([
      (async () => { const chunks: Uint8Array[] = []; let bytes = 0;
        for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 512) throw new Error(); chunks.push(next.value); }
        return Buffer.concat(chunks).toString('utf8'); })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 2000); }),
    ]);
    parsed = action.parse(JSON.parse(raw));
  } catch { return json({ error: 'Invalid Recon action' }, 400); }
  finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
  try {
    if (parsed.action === 'generate') return json(await generateReconSnapshot(user.user.id, id));
    return json(await transmitReconSnapshot(user.user.id, id, parsed.snapshotId, parsed.provider));
  } catch (error) { return fail(error); }
}
