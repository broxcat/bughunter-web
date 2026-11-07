import { constants } from 'node:fs';
import { open, mkdir, type FileHandle } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { ResearchError, workspacePath } from './workspace';

/** Anchor every operation in open, non-symlink directories (Linux workspace contract). */
export async function publicationRoot(root: string, create = false): Promise<FileHandle> {
  if (root === '/' || !isAbsolute(root) || resolve(root) !== root) throw new ResearchError('Unsafe publication root', 409);
  let directory = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of root.split('/').filter(Boolean)) {
      const path = `/proc/self/fd/${directory.fd}/${part}`;
      if (create) await mkdir(path, { mode: 0o3770 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      const next = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close(); directory = next;
    }
    return directory;
  } catch (error) { await directory.close(); if (['ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new ResearchError('Unsafe publication root', 409); throw error; }
}

export async function descriptorCommand(command: string, args: string[], file: FileHandle, timeout = 35000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'ignore', file.fd] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new ResearchError('Workspace publication is busy or unavailable', 409)); });
  });
}

/**
 * flock attaches to this open-file description, inherited as fd 3. The helper
 * exits after acquisition; this parent FD retains the kernel lock until close.
 * Process death closes it automatically: no lease, PID guessing or stale lock
 * file deletion. Never unlink lock files (that would create two lock identities).
 * All web replicas must use the same local filesystem, as the existing workspace
 * mount contract requires. Unsupported locking fails closed.
 */
export async function withPublicationLock<T>(root: string, workspaceId: string, work: () => Promise<T>): Promise<T> {
  workspacePath(root, workspaceId);
  const directory = await publicationRoot(root, true);
  let locks: FileHandle | undefined, lock: FileHandle | undefined;
  try {
    const gid = Number(process.env.RESEARCH_WORKSPACE_GID ?? process.getgid?.());
    if (!Number.isSafeInteger(gid) || gid < 0) throw new ResearchError('Invalid workspace group');
    const rootInfo = await directory.stat();
    if (rootInfo.uid !== process.getuid?.() || rootInfo.mode & 0o002) throw new ResearchError('Unsafe publication root ownership or permissions', 409);
    await directory.chown(process.getuid!(), gid); await directory.chmod(workspaceId.startsWith('research_') ? 0o711 : 0o3770);
    const path = `/proc/self/fd/${directory.fd}/.provisioning-locks`;
    await mkdir(path, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    locks = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const stat = await locks.stat();
    if (stat.uid !== process.getuid?.() || stat.mode & 0o077) throw new ResearchError('Unsafe publication locks', 409);
    lock = await open(`/proc/self/fd/${locks.fd}/${workspaceId}`, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const info = await lock.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || info.mode & 0o077) throw new ResearchError('Unsafe publication lock', 409);
    await descriptorCommand('flock', ['--exclusive', '--timeout', '30', '3'], lock);
    return await work();
  } finally { await lock?.close(); await locks?.close(); await directory.close(); }
}
