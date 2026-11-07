import { constants, readFileSync } from 'node:fs';
import { open, realpath, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { consolePolicySchema } from '../../../src/lib/research/consolePolicy.ts';
import { readBounded } from './burp-files.mjs';
import { authorizeRuntimeWorkspace } from './runtime-binding.mjs';
const flags = 0x200000 | constants.O_DIRECTORY | constants.O_NOFOLLOW;
export const childPath = (parent, name) => `/proc/self/fd/${parent.fd}/${name}`;
export async function openConsoleWorkspace(cwd = process.cwd()) {
  return authorizeRuntimeWorkspace(readConsoleWorkspace, cwd);
}
export async function openTrustedConsoleWorkspace(cwd) {
  const serviceUid=Number(readFileSync('/etc/passwd','utf8').split('\n').find(line=>line.startsWith('researcher:'))?.split(':')[2]);
  if (![0, serviceUid].includes(process.getuid())) throw new Error('TRUSTED_SERVICE_REQUIRED');
  return readConsoleWorkspace(cwd);
}
async function readConsoleWorkspace(cwd) {
  await access(cwd + '/.deleting').then(() => { throw new Error('WORKSPACE_DELETING'); }, e => { if (e.code !== 'ENOENT') throw e; });
  const physical = await realpath(cwd);
  if (physical !== cwd || !/^\/workspaces\/research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(cwd)) throw new Error('WORKSPACE_REQUIRED');
  let root = await open('/', flags), agents, metadata;
  try {
    for (const part of cwd.split('/').filter(Boolean)) { const next = await open(childPath(root, part), flags); await root.close(); root = next; }
    agents = await open(childPath(root, '.agents'), flags); metadata = await open(childPath(agents, 'bughunter'), flags);
    const raw = await readBounded(metadata, 'policy.json', 1024 * 1024, true), policy = consolePolicySchema.parse(JSON.parse(raw));
    const scope = await readBounded(root, 'scope.md', 1024 * 1024, true);
    if (policy.workspaceId !== cwd.split('/').at(-1) || createHash('sha256').update(scope).digest('hex') !== policy.scopeSha256) throw new Error('POLICY_CHANGED');
    const target = JSON.parse(await readBounded(metadata, 'target.json', 65536, true));
    if (target.id !== policy.targetId || target.host !== policy.targetHost || target.requiredUserAgent !== policy.requiredUserAgent) throw new Error('POLICY_CHANGED');
    const session=JSON.parse(await readBounded(metadata,'session.json',16384,true));
    if(session.source!==`ResearchSession ${policy.sessionId}`||session.targetId!==policy.targetId||session.workspaceId!==policy.workspaceId)throw new Error('POLICY_CHANGED');
    return { root, policy, policySha256: createHash('sha256').update(raw).digest('hex') };
  } catch (e) { await root.close(); throw e; }
  finally { await metadata?.close(); await agents?.close(); }
}
