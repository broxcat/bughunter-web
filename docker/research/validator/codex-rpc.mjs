import { spawn } from 'node:child_process';
export async function codexRead(method, params, cwd = process.cwd(), timeout = 5000) {
  const trust = `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`;
  const child = spawn('codex', ['-c', trust, 'app-server', '--stdio'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '', bytes = 0, next = 1, timer;
  const waiting = new Map();
  const request = (method, params) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  child.stdout.on('data', chunk => {
    bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { child.kill('SIGKILL'); return; }
    buffer += chunk;
    let pos; while ((pos = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
      try { const message = JSON.parse(line), pending = waiting.get(message.id); if (pending) { waiting.delete(message.id); if (message.error) pending.reject(new Error('CODEX_READ_UNAVAILABLE')); else pending.resolve(message.result); } } catch { /* No output or upstream instructions are evaluated. */ }
    }
  });
  const fail = () => { for (const pending of waiting.values()) pending.reject(new Error('CODEX_READ_UNAVAILABLE')); };
  child.on('error', fail); child.on('close', fail);
  try {
    return await Promise.race([
      (async () => { await request('initialize', { clientInfo: { name: 'bughunter-research', version: '1.0.0' }, capabilities: { experimentalApi: true } }); child.stdin.write('{"method":"initialized"}\n'); return request(method, params); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CODEX_READ_TIMEOUT')), timeout); }),
    ]);
  } finally { clearTimeout(timer); child.stdin.end(); child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 500); force.unref(); }
}
