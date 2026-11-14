// Only Playwright and this broker belong in this networkless image.
import http from 'node:http';
import net from 'node:net';
import { mkdir, chmod, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chromium } from 'playwright-chromium';

const directory = '/run/browser';
await mkdir(directory, { recursive: true });
const sessions = new Map();
const args = ['--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-background-networking'];
async function terminate(session) {
  if (session.stopping) return session.stopping;
  session.stopping = (async () => {
    clearTimeout(session.timer);
    const child = session.browser.process();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await exited;
    }
    for (const socket of session.connections) socket.destroy();
    session.proxy?.close();
    if (session.socket) await unlink(session.socket).catch(() => {});
    sessions.delete(session.id);
  })();
  return session.stopping;
}
const broker = http.createServer(async (req, res) => {
  let created;
  try {
    if (req.method === 'DELETE' && /^\/sessions\/[a-f0-9-]{36}$/.test(req.url)) {
      const session = sessions.get(req.url.split('/').at(-1));
      if (session) await terminate(session);
      res.writeHead(200).end('{}'); return;
    }
    if (req.method !== 'POST' || !/^\/sessions\/(target|pdf)$/.test(req.url)) { res.writeHead(404).end(); return; }
    if (sessions.size >= 4) { res.writeHead(429).end(); return; }
    const id = randomUUID();
    const session = { id, connections: new Set() };
    created = session;
    sessions.set(id, session);
    res.once('close', () => {
      if (!res.writableFinished) { session.cancelled = true; if (session.browser) void terminate(session); }
    });
    try {
      session.browser = await chromium.launchServer({ channel: 'chromium', headless: true, chromiumSandbox: true, timeout: 10_000, host: '127.0.0.1', env: { PATH: process.env.PATH, HOME: '/tmp', PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' }, args });
    } catch (error) { sessions.delete(id); throw error; }
    if (session.cancelled) { await terminate(session); return; }
    const endpoint = new URL(session.browser.wsEndpoint());
    session.socket = `${directory}/${id}.sock`;
    session.proxy = net.createServer(client => {
      const upstream = net.connect(Number(endpoint.port), '127.0.0.1');
      for (const socket of [client, upstream]) { session.connections.add(socket); socket.once('close', () => session.connections.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy(); }); }
      client.pipe(upstream).pipe(client);
    });
    await new Promise((resolve, reject) => { session.proxy.once('error', reject); session.proxy.listen(session.socket, resolve); });
    await chmod(session.socket, 0o600);
    session.timer = setTimeout(() => void terminate(session), req.url.endsWith('/pdf') ? 30_000 : 300_000);
    session.browser.on('close', () => void terminate(session));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, socket: session.socket, path: endpoint.pathname }));
  } catch (error) {
    if (created?.browser) await terminate(created);
    console.error('Browser operation failed:', error.message);
    if (!res.headersSent) res.writeHead(503).end('{}');
  }
});
broker.requestTimeout = 15_000;
broker.headersTimeout = 10_000;
broker.maxConnections = 32;
const socketPath = `${directory}/broker.sock`;
await unlink(socketPath).catch(() => {});
broker.listen(socketPath, async () => { await chmod(socketPath, 0o600); console.log('Networkless browser broker ready'); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { broker.close(); await Promise.all([...sessions.values()].filter(s => s.browser).map(terminate)); process.exit(0); });
