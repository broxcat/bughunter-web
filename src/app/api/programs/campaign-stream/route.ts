import { withApiBoundary } from '@/lib/apiBoundary';
import { auth } from '@/lib/auth';
import { loadCampaignActivity } from '@/server/targetCampaign';

export const runtime = 'nodejs';
const interval = 2500;

 async function handleGET(request: Request) {
  const ownerId = (await auth())?.user?.id;
  if (!ownerId) return new Response('Unauthorized', { status: 401 });
  const ids = [...new Set((new URL(request.url).searchParams.get('ids') ?? '').split(','))];
  if (ids.length > 100 || ids.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    return new Response('Invalid Target IDs', { status: 400 });
  }
  const initial = await loadCampaignActivity(ownerId, ids);
  if (initial.some(row => !row)) return new Response('Not found', { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cleanup = () => {
    closed = true;
    clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener('abort', onAbort);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => { cleanup(); controller.close(); };
      request.signal.addEventListener('abort', onAbort, { once: true });
      let last = '';
      function publish(rows: Awaited<ReturnType<typeof loadCampaignActivity>>) {
        if (closed) return;
        const payload = JSON.stringify(rows);
        try { controller.enqueue(encoder.encode(payload === last ? ': ping\n\n' : 'data: ' + payload + '\n\n')); }
        catch { cleanup(); return; }
        last = payload;
        if (!rows.some(row => row?.active)) {
          cleanup();
          controller.close();
        } else timer = setTimeout(tick, interval);
      }
      async function tick() {
        try { publish(await loadCampaignActivity(ownerId!, ids)); }
        catch {
          if (!closed) timer = setTimeout(tick, interval);
        }
      }
      if (request.signal.aborted) { cleanup(); controller.close(); }
      else publish(initial);
    },
    cancel: cleanup,
  });

  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}

export const GET = withApiBoundary(handleGET, []);
