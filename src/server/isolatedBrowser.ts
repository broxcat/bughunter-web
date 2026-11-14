import http from 'node:http';
import net from 'node:net';
import { posix } from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright-chromium';
import { browserSandboxEnabled } from './browserPolicy';

type Session = { id: string; path: string };
class BrokerRefusal extends Error {}
function brokerSocket() {
  browserSandboxEnabled();
  const socket = process.env.BROWSER_SOCKET_PATH;
  if (process.platform !== 'linux' || !socket?.startsWith('/')) throw new Error('Isolated Linux browser service is required (BROWSER_SOCKET_PATH)');
  return socket;
}
async function command<T>(socketPath: string, method: string, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method, path, timeout: 15_000 }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 4096) res.destroy(new Error('Browser broker response too large')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new BrokerRefusal('Browser service refused operation')); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Browser broker deadline')));
    req.on('error', reject); req.end();
  });
}
export class BrowserTerminationUnconfirmed extends Error {}
/** No TCP endpoint and no local launch fallback. close() awaits OS process exit. */
export async function launchIsolatedBrowser(_options: LaunchOptions = {}, profile: 'target' | 'pdf' = 'target'): Promise<Browser> {
  void _options; // Broker owns launch flags; callers cannot weaken isolation.
  const socketPath = brokerSocket();
  const session = await command<Session>(socketPath, 'POST', `/sessions/${profile}`).catch(error => {
    if (error instanceof BrokerRefusal) throw error;
    throw new BrowserTerminationUnconfirmed('Browser startup response lost; termination unconfirmed');
  });
  if (!session || typeof session.id !== 'string' || typeof session.path !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(session.id) || !/^\/[A-Za-z0-9_-]{1,128}$/.test(session.path))
    throw new BrowserTerminationUnconfirmed('Malformed browser session; termination unconfirmed');
  // The hostile-side broker cannot choose an arbitrary Unix socket in the
  // application container. Derive the sole permitted session socket locally.
  const sessionSocket = posix.join(posix.dirname(socketPath), session.id + '.sock');
  const sockets = new Set<net.Socket>();
  const bridge = net.createServer(client => {
    const upstream = net.connect(sessionSocket);
    for (const socket of [client, upstream]) { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy(); }); }
    client.pipe(upstream).pipe(client);
  });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    try { await command(socketPath, 'DELETE', `/sessions/${session.id}`); }
    catch { throw new BrowserTerminationUnconfirmed('Browser termination was not confirmed; lease quarantined until safe cleanup'); }
    finally { for (const socket of sockets) socket.destroy(); bridge.close(); }
  })();
  try {
    await new Promise<void>((resolve, reject) => { bridge.once('error', reject); bridge.listen(0, '127.0.0.1', resolve); });
    const { port } = bridge.address() as net.AddressInfo;
    const browser = await chromium.connect(`ws://127.0.0.1:${port}${session.path}`, { timeout: 10_000 });
    return new Proxy(browser, { get(target, key) { if (key === 'close') return stop; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  } catch (error) { await stop(); throw error; }
}
