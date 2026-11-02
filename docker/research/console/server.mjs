import { diagnoseProviderBurp } from './mcp-diagnostics.mjs';
import { startBurpTunnel } from './burp-tunnel.mjs';
await startBurpTunnel();
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { stopWorkspaceProcesses, deleteWorkspaceThreads, deleteClaudeWorkspaceThreads } from './stop.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { verifyTerminalTicket, verifyStopTicket, targetWorkspaceId } from '../../../src/lib/research/terminal.ts';
import { openConsoleWorkspace } from '../validator/console-files.mjs';
import { sessionCommand, providerStatus } from './providers.mjs';
import { providerTmuxIdentity } from '../../../src/lib/research/provider.ts';
import { reconnectWorkspaceBurp } from './burp-reconnect.mjs';
import { stageReconContext } from './recon-context.mjs';
const exec = promisify(execFile);
export async function startTerminalService({ port = 7681, host = '0.0.0.0', origin = process.env.RESEARCH_TERMINAL_ORIGIN, publicKey } = {}) {
  publicKey ??= await readFile(process.env.RESEARCH_TERMINAL_PUBLIC_KEY_FILE ?? '/run/research-terminal/public.pem', 'utf8');
  if (!origin) throw new Error('Set the public Research terminal origin');
  const parsedOrigin = new URL(origin);
  if (!['http:','https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('Set the public Research terminal origin');
  origin = parsedOrigin.origin;
  const spent = new Map(), connections = new Set(), pending = new Map();
  const reconDeliveries = new Map();
  let claudeCreation = Promise.resolve();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false, handleProtocols: protocols => protocols.has('bh-terminal.v1') ? 'bh-terminal.v1' : false });
  const server = createServer((req, res) => { void (async () => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/control/recon' && req.method === 'POST') {
      try {
        const staged = await stageReconContext(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), publicKey, exec, reconDeliveries);
        res.end(JSON.stringify(staged));
      } catch (error) {
        res.writeHead(error.deliveryUncertain ? 202 : 409);
        res.end(error.deliveryUncertain ? '{"status":"UNKNOWN"}' : '{"error":"Recon context could not be staged"}');
      }
      return;
    }
    if (req.url === '/control/stop' && req.method === 'POST') {
      try {
        const claims = verifyStopTicket(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), publicKey);
        for (const ws of connections) if (ws.targetId === claims.targetId) ws.close(1008, 'Target deletion');
        await Promise.all(['codex', 'claude'].map(provider => pending.get(providerTmuxIdentity(claims.targetId, provider))?.catch(() => {})));
        const paths = claims.workspaceId.startsWith('research_') ? [`/workspaces/${claims.workspaceId}`] : [`/legacy-workspaces/${claims.workspaceId}`];
        // Capture descendants before tmux exits/reparents them, then stop the session.
        await stopWorkspaceProcesses(paths);
        await deleteWorkspaceThreads(paths);
        await deleteClaudeWorkspaceThreads(paths);
        for (const provider of ['codex', 'claude']) {
          const identity = providerTmuxIdentity(claims.targetId, provider);
          await pending.get(identity)?.catch(() => {});
          await exec('tmux', ['kill-session', '-t', `=${identity}`], { timeout: 3000 }).catch(() => {});
        }
        await stopWorkspaceProcesses(paths);
        res.end('{"stopped":true}');
      } catch { res.writeHead(503); res.end('{"error":"Cleanup unconfirmed"}'); }
      return;
    }
    res.writeHead(req.url === '/health' ? 200 : 404); res.end(req.url === '/health' ? '{"status":"ok"}' : '{"error":"Not found"}');
  })().catch(() => {res.writeHead(503);res.end();}); });
  function claim(token) {
    const claims = verifyTerminalTicket(token, publicKey);
    for (const [key, expiry] of spent) if (expiry < Date.now()) spent.delete(key);
    if (spent.has(claims.nonce) || spent.size >= 10000) throw new Error('TICKET_REPLAY');
    spent.set(claims.nonce, claims.exp * 1000); return claims;
  }
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      try {
        if (req.headers.cookie || req.headers.authorization || req.headers['proxy-authorization'] || req.headers.origin !== origin || connections.size >= 32) throw new Error('DENIED');
        const match = /^\/research-terminal\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})$/.exec(req.url ?? '');
        const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(s => s.trim());
        if (!match || !protocols.includes('bh-terminal.v1')) throw new Error('DENIED');
        const token = protocols.find(s => s.startsWith('ticket.'))?.slice(7); if (!token) throw new Error('DENIED');
        const claims = claim(token); if (claims.targetId !== match[1]) throw new Error('DENIED');
        const workspace = await openConsoleWorkspace(`/workspaces/${targetWorkspaceId(claims.targetId)}`);
        try { if (workspace.policy.sessionId !== claims.sessionId || workspace.policySha256 !== claims.policySha256) throw new Error('POLICY_CHANGED'); }
        finally { await workspace.root.close(); }
        wss.handleUpgrade(req, socket, head, ws => { wss.emit('connection', ws, claims); });
      } catch (error) {
        const code = ['DENIED','INVALID_TICKET','EXPIRED_TICKET','TICKET_REPLAY','POLICY_CHANGED','UNSAFE_FILE','WORKSPACE_REQUIRED'].includes(error.message) ? error.message : 'CONFIG_UNAVAILABLE';
        console.info(JSON.stringify({operation:'terminal-admission',code}));
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
    })();
  });
  wss.on('connection', (ws, claims) => {
    const provider = claims.provider ?? 'codex';
    ws.targetId = claims.targetId; connections.add(ws); let terminal, closed = false, lease = claims.exp * 1000, inputBytes = 0, messages = 0, checking = false, auth = 'checking';
    const send = value => { if (ws.readyState === ws.OPEN) { if (ws.bufferedAmount > 1024 * 1024) ws.close(1009, 'Slow terminal'); else ws.send(JSON.stringify(value)); } };
    const checkBurp = async (reconnect = false) => {
      if (checking || closed) return; checking = true;
      send({ type: 'status', provider, authentication: auth, codex: provider === 'codex' ? auth : undefined, burp: 'starting' });
      try {
        if (reconnect) await reconnectWorkspaceBurp(`/workspaces/${targetWorkspaceId(claims.targetId)}`);
        const diagnostic = await diagnoseProviderBurp(provider, `/workspaces/${targetWorkspaceId(claims.targetId)}`);
        send({ type: 'status', provider, authentication: auth, codex: provider === 'codex' ? auth : undefined, burp: diagnostic.status, burpDetails: { provider: diagnostic.provider, toolCount: diagnostic.toolCount, version: diagnostic.version, optional: diagnostic.optional } });
      } finally { checking = false; }
    };
    let probing = false;
    const checkEngines = async () => {
      if (closed || probing) return;
      probing = true;
      try {
        const engines = await Promise.all(['codex', 'claude'].map(engine => providerStatus(engine, undefined, `/workspaces/${targetWorkspaceId(claims.targetId)}`)));
        const selected = engines.find(engine => engine.provider === provider);
        auth = selected.authentication === 'authenticated' ? 'signed in' : selected.authentication === 'required' ? 'login required' : 'unknown';
        send({ type: 'engine_status', engines });
        send({ type: 'provider_status', ...selected });
      } finally { probing = false; }
    };
    const statusTimer = setInterval(() => { void checkEngines().catch(() => {}); }, 30000);
    const burpTimer = setInterval(() => { void checkBurp(); }, 30000);
    const leaseTimer = setInterval(() => { inputBytes = 0; messages = 0; if (Date.now() > lease) ws.close(1008, 'Renew authorization'); }, 1000);
    ws.on('close', () => { closed = true; clearInterval(leaseTimer); clearInterval(burpTimer); clearInterval(statusTimer); connections.delete(ws); terminal?.kill(); }); // tmux/Codex survives detach.
    ws.on('error', () => ws.close());
    void (async () => {
      try {
        const { name, launcher } = sessionCommand(claims.targetId, provider), cwd = `/workspaces/${targetWorkspaceId(claims.targetId)}`;
        // Serialize creation within the service. tmux's own unique name is the
        // second boundary across reconnects/processes. Never pass a client command.
        const previous = provider === 'claude' ? Promise.all([pending.get(name), claudeCreation]) : pending.get(name) ?? Promise.resolve();
        const creating = previous.catch(() => {}).then(async () => {
          await access(cwd + '/.deleting').then(() => { throw new Error('DENIED'); }, e => { if (e.code !== 'ENOENT') throw e; });
          try { await exec('tmux', ['has-session', '-t', `=${name}`], { timeout: 3000 }); }
          catch {
            const availability = await providerStatus(provider, undefined, cwd);
            if (availability.installation !== 'available') { send({ type: 'provider_status', ...availability }); throw new Error(availability.code); }
            if (provider === 'claude') {
              const sessions = await exec('tmux', ['list-sessions', '-F', '#{session_name}'], { timeout: 3000 }).then(result => result.stdout.split('\n'), () => []);
              if (sessions.filter(name => name.startsWith('bughunter_claude_')).length >= 8) throw new Error('CLAUDE_SESSION_LIMIT');
            }
            try { await exec('tmux', ['-f', '/etc/bughunter/tmux.conf', 'new-session', '-d', '-s', name, '-c', cwd, launcher], { timeout: 5000 }); }
            catch { await exec('tmux', ['has-session', '-t', `=${name}`], { timeout: 3000 }); }
          }
        });
        if (provider === 'claude') claudeCreation = creating.catch(() => {});
        pending.set(name, creating); try { await creating; } finally { if (pending.get(name) === creating) pending.delete(name); }
        if (closed) return;
        const env = { PATH: process.env.PATH, HOME: '/home/researcher', USER: 'researcher', LOGNAME: 'researcher', TERM: 'xterm-256color', LANG: 'C.UTF-8', CODEX_HOME: '/home/researcher/.codex', PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' };
        terminal = pty.spawn('tmux', ['attach-session', '-t', `=${name}`], { name: 'xterm-256color', cwd, env, cols: 120, rows: 32 });
        terminal.onData(data => send({ type: 'output', data })); terminal.onExit(() => ws.close(1000, 'Console detached'));
        send({ type: 'ready', provider });
        await checkEngines();
        await checkBurp();
      } catch (error) { console.info(JSON.stringify({operation:'terminal-attach',code:'CONSOLE_START_FAILED',targetId:claims.targetId})); send({ type: 'error', code: ['CLI_MISSING', 'CLI_CHECK_FAILED', 'CLAUDE_SESSION_LIMIT'].includes(error.message) ? error.message : 'CONSOLE_UNAVAILABLE' }); ws.close(1011, 'Console unavailable'); }
    })();
    ws.on('message', (data, binary) => {
      try {
        messages++; if (binary || messages > 100 || (inputBytes += data.length) > 65536) throw new Error();
        const message = JSON.parse(data.toString());
        if (message.type === 'input' && Object.keys(message).length === 2 && typeof message.data === 'string' && message.data.length <= 8192) terminal?.write(message.data);
        else if (message.type === 'resize' && Object.keys(message).length === 3 && [message.cols, message.rows].every(n => Number.isInteger(n) && n >= 2 && n <= 500)) terminal?.resize(message.cols, message.rows);
        else if (message.type === 'reconnect_mcp' && Object.keys(message).length === 1) { void checkBurp(true); }
        else if (message.type === 'renew' && Object.keys(message).length === 2 && typeof message.token === 'string') {
          const next = claim(message.token); if (['targetId','userId','sessionId','policySha256'].some(k => next[k] !== claims[k])) throw new Error(); if ((next.provider ?? 'codex') !== provider) { ws.close(1008, 'Provider selection changed. Reconnect.'); return; } lease = next.exp * 1000;
        } else throw new Error();
      } catch { ws.close(1008, 'Invalid terminal message'); }
    });
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  return { server, close: async () => { for (const ws of connections) ws.terminate(); await new Promise(resolve => server.close(resolve)); wss.close(); } };
}
if (process.argv[1]?.endsWith('/console/server.mjs')) {
  const service = await startTerminalService();
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { void service.close().then(() => process.exit(0)); });
  console.log('Research terminal ready; authenticated per-target PTY only.');
}
