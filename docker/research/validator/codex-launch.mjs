import { spawn } from 'node:child_process';
import { openConsoleWorkspace } from './console-files.mjs';
import { readBounded } from './burp-files.mjs';
import { open, constants } from 'node:fs/promises';
import { consoleMcpOverrides } from './console-mcp-config.mjs';
import { codexRead } from './codex-rpc.mjs';
import { codexProfileArguments } from '../../../src/lib/research/launchProfiles.mjs';
const input = process.argv.slice(2);
const profile = input[0] === '--bughunter-profile' ? input.splice(0,2)[1] : 'yolo';
const profileArgs = codexProfileArguments(profile);
const cwd = process.cwd(), workspace = await openConsoleWorkspace();
const metadata = await open(`${cwd}/.agents/bughunter`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
let bootstrap;
try { bootstrap = await readBounded(metadata, 'bootstrap.md', 16384, true); } finally { await metadata.close(); await workspace.root.close(); }
if(!bootstrap)throw new Error('BOOTSTRAP_REQUIRED');
console.log(`Target: ${workspace.policy.targetHost}\nRequired User-Agent: ${workspace.policy.requiredUserAgent}\nCWD: ${cwd}\nRead scope.md before any interaction.\nHypotheses: findings/hypotheses.json; skills retain their confirmation gates.`);
// Also configure existing immutable workspaces without rewriting scope.md or
// their authorization snapshot. Project configuration is generated for new ones.
const trust = ['-c', `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`,
  ...consoleMcpOverrides(cwd)];
let args = [...profileArgs, ...trust, ...input];
if (input.length === 0) {
  let resume;
  try { const result = await codexRead('thread/list', { cwd, limit: 1, sortKey: 'updated_at', sourceKinds: ['cli'] }); resume = result.data?.find(t => t.cwd === cwd && /^[a-f0-9-]{36}$/.test(t.id))?.id; } catch { /* A bounded read failure starts with workspace context, never another CWD's conversation. */ }
  args = resume ? ['resume', ...profileArgs, ...trust, resume] : [...profileArgs, ...trust, 'Read scope.md and .agents/bughunter/bootstrap.md before continuing Research.'];
}
const child = spawn('codex', args, { cwd, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Codex could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
