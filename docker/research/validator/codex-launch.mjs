import { spawn } from 'node:child_process';
import { openConsoleWorkspace } from './console-files.mjs';
import { readBounded } from './burp-files.mjs';
import { open, constants } from 'node:fs/promises';
import { codexRead } from './codex-rpc.mjs';
const cwd = process.cwd(), workspace = await openConsoleWorkspace();
const metadata = await open(`${cwd}/.agents/bughunter`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
let bootstrap;
try { bootstrap = await readBounded(metadata, 'bootstrap.md', 16384, true); } finally { await metadata.close(); await workspace.root.close(); }
console.log(`Target: ${workspace.policy.targetHost}\nRequired User-Agent: ${workspace.policy.requiredUserAgent}\nCWD: ${cwd}\nRead scope.md before any interaction.\nHypotheses: findings/hypotheses.json; skills retain their confirmation gates.`);
const trust = ['-c', `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`];
let args = ['--yolo', ...trust, ...process.argv.slice(2)];
if (process.argv.length === 2) {
  let resume;
  try { const result = await codexRead('thread/list', { cwd, limit: 1, sortKey: 'updated_at', sourceKinds: ['cli'] }); resume = result.data?.find(t => t.cwd === cwd && /^[a-f0-9-]{36}$/.test(t.id))?.id; } catch { /* A bounded read failure starts with workspace context, never another CWD's conversation. */ }
  args = resume ? ['resume', '--yolo', ...trust, resume] : ['--yolo', ...trust, bootstrap];
}
const child = spawn('codex', args, { cwd, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Codex could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
