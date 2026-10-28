import { providerSelection, type ResearchProvider } from '@/lib/research/provider';
import { auth } from '@/lib/auth';
import { targetIdentity } from '@/lib/research/terminal';
import { terminalTicket } from '@/server/research/terminalTicket';
import { ResearchError } from '@/server/research/workspace';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // Same-origin browser action; no CORS, paths, commands, terminal options or MCP config.
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(process.env.AUTH_URL!).origin) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  if (!targetIdentity.safeParse(id).success) return Response.json({ error: 'Not found' }, { status: 404 });
  let provider: ResearchProvider | undefined;
  if (req.body !== null) {
    const reader = req.body.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        (async () => {
          const chunks: Uint8Array[] = []; let size = 0;
          for (;;) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 128) throw new Error('Invalid selection');
            chunks.push(chunk.value);
          }
          return Buffer.concat(chunks).toString('utf8');
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), 2000); }),
      ]);
      if (raw) provider = providerSelection.parse(JSON.parse(raw)).provider;
    } catch { return Response.json({ error: 'Expected only a Codex or Claude provider selection' }, { status: 400 }); }
    finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
  }
  try { return Response.json(await terminalTicket(session.user.id, id, provider), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof ResearchError ? error.message : 'Research console unavailable' }, { status: error instanceof ResearchError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } }); }
}
