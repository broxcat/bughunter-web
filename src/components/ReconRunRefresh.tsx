'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Merge RSC updates into the existing keyed view: retain scroll, focus and
 * expanded raw logs. No scan/mutation endpoint is ever called here.
 * The terminal *rendered* snapshot stops polling, so a failed final refresh
 * cannot strand the page on Running. A transient failure backs off and retries.
 */
export default function ReconRunRefresh({ programId, runId, status }: { programId: string; runId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('Live updates every 5 seconds.');
  const reading = useRef<{ node: Element; top: number; runId: string } | null>(null);
  const merging = useRef(false);
  useLayoutEffect(() => {
    if (pending) { merging.current = true; return; }
    if (!merging.current) return;
    merging.current = false;
    const anchor = reading.current;
    reading.current = null;
    if (anchor?.runId === runId && anchor.node.isConnected) {
      // RSC preserves scrollY, but growing evidence above it can move the
      // actual text being read. Restore that DOM anchor after the merge.
      window.scrollBy({ top: anchor.node.getBoundingClientRect().top - anchor.top, behavior: 'instant' });
    }
  }, [pending, runId]);
  useEffect(() => {
    const cancel = () => { reading.current = null; };
    const key = (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel(); };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchmove', cancel, { passive: true });
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('wheel', cancel); window.removeEventListener('touchmove', cancel); window.removeEventListener('keydown', key); };
  }, []);
  const active = status === 'QUEUED' || status === 'RUNNING';
  useEffect(() => {
    if (!active || pending) return;
    let disposed = false, failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const response = await fetch(`/api/programs/${encodeURIComponent(programId)}/recon?runId=${encodeURIComponent(runId)}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) {
          if (response.status === 401 || response.status === 404) {
            if (!disposed) setMessage('Live updates stopped: access or run unavailable.');
            return;
          }
          throw new Error('Recon update unavailable');
        }
        const run = await response.json();
        if (run.id !== runId || !['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) throw new Error('Invalid Recon update');
        if (disposed) return;
        failures = 0;
        setMessage('Live updates every 5 seconds.');
        // Do not interrupt selection/copy. The next heartbeat resumes updates.
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          timer = setTimeout(tick, 5000);
          return;
        }
        const focused = document.activeElement;
        const node = focused && focused !== document.body && focused.getBoundingClientRect().bottom > 0 && focused.getBoundingClientRect().top < innerHeight
          ? focused : document.elementFromPoint(innerWidth / 2, innerHeight / 3)?.closest('p, li, tr, summary, h1, h2, h3, pre, section');
        reading.current = node ? { node, top: node.getBoundingClientRect().top, runId } : null;
        startTransition(() => router.refresh());
      } catch {
        if (disposed) return;
        failures++;
        setMessage('Live update unavailable. Retrying automatically; recorded data remains visible.');
      }
      if (!disposed) timer = setTimeout(tick, Math.min(30000, 5000 * 2 ** Math.min(failures, 3)));
    };
    timer = setTimeout(tick, 5000);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [active, pending, programId, runId, router]);
  return <p role="status" className="text-sm text-muted" data-recon-refresh={active ? 'active' : 'stopped'}>
    {active ? message : 'Run finished. Live updates stopped.'}
  </p>;
}
