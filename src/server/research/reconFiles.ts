import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { workspacePath, ResearchError } from './workspace';
import { reconHash } from './reconContext';

/** Walk every ancestor with O_NOFOLLOW; never adopt operator-controlled links. */
export async function openReconDirectory(root: string, workspaceId: string) {
  const path = workspacePath(root, workspaceId);
  let directory = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of resolve(path, 'recon').split('/').filter(Boolean)) {
      const next = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close(); directory = next;
    }
    const stat = await directory.stat();
    if (stat.uid !== process.getuid?.() || stat.mode & 0o022) throw new ResearchError('Unsafe Recon directory', 409);
    return directory;
  } catch (error) { await directory.close(); throw error; }
}
async function immutableFile(directory: FileHandle, name: string, text: string, limit: number) {
  if (Buffer.byteLength(text) > limit) throw new ResearchError('Recon artifact exceeds limit', 409);
  const path = `/proc/self/fd/${directory.fd}/${name}`;
  let file: FileHandle;
  try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const old = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await old.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o222 || stat.size > limit || reconHash(await old.readFile('utf8')) !== reconHash(text)) throw new ResearchError('Recon artifact integrity mismatch', 409);
    } finally { await old.close(); }
    return;
  }
  try {
    await file.chown(process.getuid!(), Number(process.env.RESEARCH_WORKSPACE_GID ?? process.getgid?.()));
    await file.writeFile(text); await file.sync(); await file.chmod(0o440);
  } finally { await file.close(); }
}
export async function publishReconFiles(root: string, workspaceId: string, snapshot: { contentSha256: string; contextText: string; summaryText: string }) {
  if (!/^[a-f0-9]{64}$/.test(snapshot.contentSha256) || reconHash(snapshot.contextText) !== snapshot.contentSha256) throw new ResearchError('Invalid Recon digest');
  const directory = await openReconDirectory(root, workspaceId);
  try {
    await immutableFile(directory, `snapshot-${snapshot.contentSha256}.json`, snapshot.contextText, 1024 * 1024);
    await immutableFile(directory, `summary-${snapshot.contentSha256}.json`, snapshot.summaryText, 24 * 1024);
  } finally { await directory.close(); }
}
