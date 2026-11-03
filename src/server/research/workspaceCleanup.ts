import { constants } from 'node:fs';
import { open, lstat, rm, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { workspacePath, ResearchError } from './workspace';
async function safeRoot(root: string) {
  if (await realpath(root) !== resolve(root)) throw new ResearchError('Unsafe workspace root', 409);
}
export async function revokeWorkspace(root: string, workspaceId: string) {
  const path = workspacePath(root, workspaceId);
  try {
    await safeRoot(root);
    const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const marker = await open(`/proc/self/fd/${directory.fd}/.deleting`, constants.O_RDONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o440);
      await marker.close();
    } finally { await directory.close(); }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
export async function removeWorkspace(root: string, workspaceId: string) {
  try { await safeRoot(root); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  const path = workspacePath(root, workspaceId);
  for (const entry of [path, join(root, `.tmp-${workspaceId}`), join(root, '.exports', `${workspaceId}.zip`), join(root, '.exports', `.tmp-${workspaceId}`)]) {
    // Never traverse an operator-replaced export directory.
    if (dirname(entry) !== root) {
      const parent = await lstat(dirname(entry)).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (!parent) continue;
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new ResearchError('Unsafe workspace export', 409);
    }
    await rm(entry, { recursive: true, force: true });
  }
}
