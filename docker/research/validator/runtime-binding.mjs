import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Fixed trusted registry. Shell environment, cwd and caller paths never select
// an identity. Provisioning/activation belongs to the trusted launcher broker.
const registry = ['var', 'lib', 'bughunter-identities', 'active'];
// Linux O_PATH permits descriptor-anchored traversal without directory listing.
const directoryFlags = 0x200000 | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const identity = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const digest = /^[a-f0-9]{64}$/;
const denied = () => new Error('RESEARCH_IDENTITY_DENIED');

export function checkRuntimeBinding(binding, { uid, gid, policy, policySha256 }) {
  const keys = ['v', 'uid', 'gid', 'targetId', 'workspaceId', 'sessionId', 'policySha256', 'state'];
  if (!binding || typeof binding !== 'object' || Object.keys(binding).length !== keys.length || keys.some(key => !Object.hasOwn(binding, key)) ||
      binding.v !== 1 || binding.state !== 'active' || !Number.isSafeInteger(uid) || uid < 200000 ||
      binding.uid !== uid || binding.gid !== gid || uid !== gid ||
      !identity.test(binding.targetId) || !identity.test(binding.sessionId) ||
      binding.workspaceId !== `research_${binding.targetId}` || !digest.test(binding.policySha256) ||
      binding.targetId !== policy.targetId || binding.workspaceId !== policy.workspaceId ||
      binding.sessionId !== policy.sessionId || binding.policySha256 !== policySha256) throw denied();
  return Object.freeze({ ...binding });
}

export async function readRuntimeBinding() {
  const uid = process.getuid(), gid = process.getgid();
  if (uid < 200000 || uid !== process.geteuid() || gid !== process.getegid() || uid !== gid || process.getgroups().some(group => group !== gid)) throw denied();
  let parent;
  try {
    parent = await open('/', directoryFlags);
    for (const part of registry) {
      const stat = await parent.stat();
      if (stat.uid !== 0 || stat.mode & 0o022) throw denied();
      const next = await open(`/proc/self/fd/${parent.fd}/${part}`, directoryFlags);
      await parent.close(); parent = next;
    }
    const stat = await parent.stat();
    if (stat.uid !== 0 || stat.mode & 0o022) throw denied();
    const file = await open(`/proc/self/fd/${parent.fd}/${uid}.json`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.uid !== 0 || stat.gid !== gid || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o440 || stat.size > 4096) throw denied();
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) throw denied();
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
    } finally { await file.close(); }
  } catch { throw denied(); }
  finally { await parent?.close(); }
}

// This is a separate explicit API until trusted broker provisioning exists.
// Do not claim the legacy openConsoleWorkspace API is identity-bound yet.
export async function authorizeRuntimeWorkspace(openWorkspace, path) {
  const binding = await readRuntimeBinding();
  // Deny a foreign name before opening its context, even if it is valid.
  if (path !== `/workspaces/${binding.workspaceId}`) throw denied();
  const workspace = await openWorkspace(path);
  try {
    checkRuntimeBinding(binding, { uid: process.getuid(), gid: process.getgid(), policy: workspace.policy, policySha256: workspace.policySha256 });
    // Re-read activation after opening inputs, so concurrent revocation cannot
    // authorize a new validation using the previous activation record.
    const current = await readRuntimeBinding();
    if (createHash('sha256').update(JSON.stringify(current)).digest('hex') !== createHash('sha256').update(JSON.stringify(binding)).digest('hex')) throw denied();
    return workspace;
  } catch (error) { await workspace.root.close(); throw error; }
}
