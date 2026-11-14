
import { guardedConnect } from '../egress/fetch';
import { acquireExecution } from '../execution';
import { beforeScanNetwork } from '../scanControl';

export async function probeTcp(host: string, port: number, signal: AbortSignal) {
  await beforeScanNetwork();
  const release = await acquireExecution({ tool: 'guarded-tcp', dnsHost: host }, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
  try {
    // Resolve once and connect to the validated address only.
    const { socket } = await guardedConnect(host, port, { signal, timeoutMs: 2500 });
    return await new Promise<'open' | 'closed' | 'filtered'>((resolve, reject) => {
      let state: 'open' | 'closed' | 'filtered' = 'filtered';
      let failure: unknown;
      const timer = setTimeout(() => socket.destroy(), 2500);
      socket.once('connect', () => { state = 'open'; socket.destroy(); });
      socket.once('error', error => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') state = 'closed';
        else failure = error;
      });
      socket.once('close', () => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else resolve(state);
      });
    });
  } finally { await release(); }
}
