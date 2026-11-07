import { constants } from 'node:fs';
import { open, mkdir, lstat, readdir, unlink, rmdir, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { publicationRoot, descriptorCommand } from './publicationLock';
import { publicationCheckpoint } from './publicationTestHooks';
import { ResearchError, workspacePath } from './workspace';
import { isResearchPlanInput } from '@/lib/research/planReference';
import { isCoverageInput } from './coverageFiles';
import { bundleZip } from './zip';

const safeName = (value: string) => /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) && value.split('/').every(p => p !== '.' && p !== '..');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fileMode = z.union([z.literal(0o440), z.literal(0o660)]);
const directoryMode = z.union([z.literal(0o2750), z.literal(0o2770), z.literal(0o3770)]);
const manifestSchema = z.object({
  version: z.literal(1), token: z.string().uuid(), layout: z.enum(['console', 'legacy']),
  sessionId: z.string().min(1).max(150), targetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
  workspaceId: z.string().regex(/^(?:research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i), policyIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative(), researcherUid: z.number().int().nonnegative(),
  files: z.record(z.string().refine(safeName), z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(0).max(16 * 1024 * 1024), mode: fileMode })),
  directories: z.record(z.string().refine(safeName), directoryMode),
  archive: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() }).nullable(),
}).strict().refine(m => Boolean(m.files['scope.md'] && m.files[m.layout === 'console' ? '.agents/bughunter/policy.json' : 'research/session.json']) && (m.layout === 'console' ? m.workspaceId === 'research_' + m.targetId && m.archive === null : !m.workspaceId.startsWith('research_') && m.archive !== null), 'Incomplete publication identity');
export type PublicationManifest = z.infer<typeof manifestSchema>;
export function readPublicationManifest(value: unknown): PublicationManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) throw new ResearchError('Unverifiable workspace reservation', 409);
  if (result.data.uid !== process.getuid?.() || result.data.gid !== Number(process.env.RESEARCH_WORKSPACE_GID ?? process.getgid?.()) || result.data.researcherUid !== Number(process.env.RESEARCH_WORKSPACE_UID ?? process.getuid?.())) throw new ResearchError('Workspace reservation ownership changed', 409);
  return result.data;
}
export function makePublicationManifest(files: Record<string, string>, identity: { sessionId: string; targetId: string; workspaceId: string; policyIdentity: string }, layout: 'console' | 'legacy'): PublicationManifest {
  const uid = process.getuid!(), gid = Number(process.env.RESEARCH_WORKSPACE_GID ?? process.getgid?.()), researcherUid = Number(process.env.RESEARCH_WORKSPACE_UID ?? uid);
  const directories: Record<string, number> = {};
  const writable = (name: string) => layout === 'console' ? /^(requests|scripts|findings)\//.test(name) : /^(research|evidence|scripts)\//.test(name) && !isResearchPlanInput(name) && !isCoverageInput(name);
  const dirMode = (name: string) => layout === 'console' ? /^(requests|scripts|findings)(\/|$)/.test(name) ? 0o2770 : 0o2750 : name === 'research' ? 0o3770 : /^(research|evidence|scripts)(\/|$)/.test(name) ? 0o2770 : 0o2750;
  if (layout === 'console') for (const name of ['recon', 'research', 'requests', 'requests/burp', 'scripts', 'findings', '.codex', '.agents', '.agents/bughunter']) directories[name] = dirMode(name);
  for (const name of Object.keys(files)) {
    if (!safeName(name)) throw new ResearchError('Invalid publication entry');
    for (let dir = dirname(name); dir !== '.'; dir = dirname(dir)) directories[dir] = dirMode(dir);
  }
  const archive = layout === 'legacy' ? bundleZip(files) : null;
  return readPublicationManifest({ version: 1, token: randomUUID(), layout, ...identity, uid, gid, researcherUid, directories,
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { sha256: hash(content), bytes: Buffer.byteLength(content), mode: writable(name) ? 0o660 : 0o440 }])),
    archive: archive ? { sha256: hash(archive), bytes: archive.length } : null,
  });
}
export const publicationTemporary = (m: PublicationManifest) => `.tmp-${m.workspaceId}-${m.token}`;
const archiveTemporary = (m: PublicationManifest) => `.tmp-${m.workspaceId}-${m.token}.zip`;
const dirUid = (m: PublicationManifest, name: string) => m.layout === 'console' && /^(requests|scripts|findings)(\/|$)/.test(name) ? m.researcherUid : m.uid;
const fileUid = (m: PublicationManifest, name: string) => m.layout === 'console' && m.files[name].mode === 0o660 ? m.researcherUid : m.uid;

async function childDirectory(parent: FileHandle, name: string) {
  try { return await open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); } catch (error) { if (['ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new ResearchError('Unsafe workspace directory', 409); throw error; }
}
async function parentFor(root: FileHandle, name: string) {
  let directory = await childDirectory(root, '.');
  try { for (const part of name.split('/').slice(0, -1)) { const next = await childDirectory(directory, part); await directory.close(); directory = next; } return directory; }
  catch (e) { await directory.close(); throw e; }
}
async function verifyTree(directory: FileHandle, m: PublicationManifest, partial: boolean, prefix = ''): Promise<void> {
  const names = await readdir(`/proc/self/fd/${directory.fd}`);
  for (const name of names) {
    const relative = prefix + name, path = `/proc/self/fd/${directory.fd}/${name}`, stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new ResearchError('Unsafe workspace link', 409);
    if (stat.isDirectory() && Object.hasOwn(m.directories, relative)) {
      if ((partial ? ![dirUid(m, relative), m.uid].includes(stat.uid) : stat.uid !== dirUid(m, relative)) || stat.gid !== m.gid || !partial && (stat.mode & 0o7777) !== m.directories[relative]) throw new ResearchError('Workspace directory integrity mismatch', 409);
      const child = await childDirectory(directory, name); try { await verifyTree(child, m, partial, relative + '/'); } finally { await child.close(); }
    } else if (stat.isFile() && Object.hasOwn(m.files, relative)) {
      const expected = m.files[relative];
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1 || (partial ? ![fileUid(m, relative), m.uid].includes(info.uid) : info.uid !== fileUid(m, relative)) || info.gid !== m.gid || (!partial && ((info.mode & 0o7777) !== expected.mode || info.size !== expected.bytes || hash(await file.readFile()) !== expected.sha256))) throw new ResearchError('Workspace file integrity mismatch', 409);
      } finally { await file.close(); }
    } else throw new ResearchError('Unexpected workspace entry; refusing recovery', 409);
  }
  if (!partial) {
    const expected = [...Object.keys(m.files), ...Object.keys(m.directories)].filter(n => dirname(n) === (prefix.slice(0, -1) || '.')).map(n => n.split('/').at(-1)!);
    if (names.length !== expected.length || expected.some(n => !names.includes(n))) throw new ResearchError('Incomplete published workspace', 409);
  }
}
async function syncDirectories(directory: FileHandle, m: PublicationManifest) {
  for (const name of Object.keys(m.directories).sort((a, b) => b.length - a.length)) {
    const parent = await parentFor(directory, name); let child;
    try { child = await childDirectory(parent, name.split('/').at(-1)!); await child.sync(); } finally { await child?.close(); await parent.close(); }
  }
  await directory.sync();
}
async function removeVerifiedTree(directory: FileHandle, m: PublicationManifest, prefix = '') {
  for (const name of await readdir(`/proc/self/fd/${directory.fd}`)) {
    const path = `/proc/self/fd/${directory.fd}/${name}`, info = await lstat(path), relative = prefix + name;
    if (info.isSymbolicLink()) throw new ResearchError('Unsafe temporary link', 409);
    if (info.isDirectory() && Object.hasOwn(m.directories, relative)) { const child = await childDirectory(directory, name); try { await removeVerifiedTree(child, m, relative + '/'); } finally { await child.close(); } await rmdir(path); }
    else if (info.isFile() && info.nlink === 1 && Object.hasOwn(m.files, relative)) await unlink(path);
    else throw new ResearchError('Unsafe temporary entry', 409);
  }
}
/** Only a DB-reserved, token-specific incomplete directory; never a final workspace. */
export async function discardPublicationTemporary(root: string, m: PublicationManifest) {
  const parent = await publicationRoot(root), path = `/proc/self/fd/${parent.fd}/${publicationTemporary(m)}`;
  let directory: FileHandle | undefined;
  try {
    try { directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    const stat = await directory.stat();
    if (stat.uid !== m.uid || stat.mode & 0o022) throw new ResearchError('Unsafe temporary workspace', 409);
    await verifyTree(directory, m, true); await removeVerifiedTree(directory, m); await rmdir(path); await parent.sync();
  } finally { await directory?.close(); await parent.close(); }
}

export async function discardPublicationArchive(root: string, m: PublicationManifest) {
  if (!m.archive || await publicationExists(root, m.workspaceId)) return;
  const parent = await publicationRoot(root); let exports: FileHandle | undefined;
  try {
    try { exports = await childDirectory(parent, '.exports'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    const directory = await exports.stat();
    if (directory.uid !== m.uid || directory.mode & 0o077) throw new ResearchError('Unsafe publication archive directory', 409);
    for (const name of [archiveTemporary(m), `${m.workspaceId}.zip`]) {
      const path = `/proc/self/fd/${exports.fd}/${name}`;
      const stat = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (!stat) continue;
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== m.uid || stat.mode & 0o077) throw new ResearchError('Unsafe incomplete publication archive', 409);
      // A final ZIP is published atomically, so only its exact reserved bytes
      // can belong to this attempt. Token-specific staging ZIPs may be partial.
      if (name === `${m.workspaceId}.zip`) {
        const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.nlink !== 1 || info.uid !== m.uid || info.mode & 0o077 || info.size !== m.archive.bytes || hash(await file.readFile()) !== m.archive.sha256) throw new ResearchError('Unexpected publication archive; refusing cleanup', 409);
        } finally { await file.close(); }
      }
      await unlink(path);
    }
    await exports.sync();
  } finally { await exports?.close(); await parent.close(); }
}
export async function publicationArchiveExists(root: string, workspaceId: string) {
  workspacePath(root, workspaceId); const parent = await publicationRoot(root); let exports: FileHandle | undefined;
  try {
    try { exports = await childDirectory(parent, '.exports'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    const info = await exports.stat();
    if (info.uid !== process.getuid?.() || info.mode & 0o077) throw new ResearchError('Unsafe publication exports', 409);
    return await lstat(`/proc/self/fd/${exports.fd}/${workspaceId}.zip`).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  } finally { await exports?.close(); await parent.close(); }
}
export async function publicationExists(root: string, workspaceId: string) {
  workspacePath(root, workspaceId); const parent = await publicationRoot(root);
  try { return await lstat(`/proc/self/fd/${parent.fd}/${workspaceId}`).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; }); } finally { await parent.close(); }
}
/** All hashes/identity/structure/modes come from the DB reservation, not a disk manifest. */
export async function verifyPublication(root: string, m: PublicationManifest) {
  workspacePath(root, m.workspaceId); const parent = await publicationRoot(root); let directory;
  try {
    directory = await childDirectory(parent, m.workspaceId); const stat = await directory.stat();
    if (stat.uid !== m.uid || stat.gid !== m.gid || (stat.mode & 0o7777) !== 0o2700) throw new ResearchError('Unsafe published workspace', 409);
    await verifyTree(directory, m, false);
    if (m.archive) {
      const exports = await childDirectory(parent, '.exports'); let file;
      try { file = await open(`/proc/self/fd/${exports.fd}/${m.workspaceId}.zip`, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); const info = await file.stat(); if (!info.isFile() || info.nlink !== 1 || info.uid !== m.uid || info.mode & 0o077 || info.size !== m.archive.bytes || hash(await file.readFile()) !== m.archive.sha256) throw new ResearchError('Workspace archive integrity mismatch', 409); }
      finally { await file?.close(); await exports.close(); }
    }
  } finally { await directory?.close(); await parent.close(); }
}
/** An unadmitted candidate cannot be traversed by the Research group over SSH. */
export async function publicationNeedsActivation(root: string, m: PublicationManifest) {
  workspacePath(root, m.workspaceId); const parent = await publicationRoot(root); let directory;
  try {
    directory = await childDirectory(parent, m.workspaceId); const info = await directory.stat(), mode = info.mode & 0o7777;
    if (info.uid !== m.uid || info.gid !== m.gid || ![0o2700, 0o2750].includes(mode)) throw new ResearchError('Unsafe workspace admission permissions', 409);
    return mode === 0o2700;
  } finally { await directory?.close(); await parent.close(); }
}
/** Call only after committed READY admission (or standalone fixture publication).
 * Crash before chmod leaves READY + a private, verifiable candidate. Retry can
 * finish this step; crash after chmod leaves the same valid READY workspace.
 * No SQL transaction spans this durable metadata I/O.
 */
export async function activatePublication(root: string, m: PublicationManifest) {
  if (!await publicationNeedsActivation(root, m)) return false;
  await publicationCheckpoint('ACTIVATION_BEGIN');
  await verifyPublication(root, m);
  const parent = await publicationRoot(root); let directory;
  try {
    directory = await childDirectory(parent, m.workspaceId); const info = await directory.stat();
    if (info.uid !== m.uid || info.gid !== m.gid || (info.mode & 0o7777) !== 0o2700) throw new ResearchError('Workspace admission changed', 409);
    await directory.chmod(0o2750); await directory.sync(); await publicationCheckpoint('AFTER_ACTIVATION');
    return true;
  } finally { await directory?.close(); await parent.close(); }
}
// Linux renameat2(RENAME_NOREPLACE): even a concurrently inserted empty directory
// or symlink cannot be overwritten. Unsupported kernels fail closed, no fallback.
const RENAME = 'import ctypes,os,sys\nf=ctypes.CDLL(None,use_errno=True).renameat2\nr=f(3,os.fsencode(sys.argv[1]),3,os.fsencode(sys.argv[2]),1)\nsys.exit(0 if r==0 else 1)';
export async function writePublication(root: string, files: Record<string, string>, m: PublicationManifest) {
  workspacePath(root, m.workspaceId);
  await publicationCheckpoint('PUBLICATION_BEGIN');
  const parent = await publicationRoot(root, true), temp = publicationTemporary(m), path = `/proc/self/fd/${parent.fd}/${temp}`;
  let directory: FileHandle | undefined, created = false;
  try {
    await mkdir(path, { mode: 0o700 }); created = true;
    directory = await childDirectory(parent, temp);
    for (const name of Object.keys(m.directories).sort((a, b) => a.length - b.length)) {
      const holder = await parentFor(directory, name); let child;
      try { await mkdir(`/proc/self/fd/${holder.fd}/${name.split('/').at(-1)!}`, { mode: 0o700 }); child = await childDirectory(holder, name.split('/').at(-1)!); await child.chown(dirUid(m, name), m.gid); await child.chmod(m.directories[name]); }
      finally { await child?.close(); await holder.close(); }
    }
    for (const [name, expected] of Object.entries(m.files)) {
      if (hash(files[name] ?? '') !== expected.sha256 || Buffer.byteLength(files[name] ?? '') !== expected.bytes) throw new ResearchError('Publication input changed', 409);
      const holder = await parentFor(directory, name); let file;
      try { file = await open(`/proc/self/fd/${holder.fd}/${name.split('/').at(-1)!}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); await file.chown(fileUid(m, name), m.gid); await file.chmod(expected.mode); await file.writeFile(files[name]); await file.sync(); await publicationCheckpoint('FILE_DURABLE'); }
      finally { await file?.close(); await holder.close(); }
    }
    if (m.archive) {
      const zip = bundleZip(files);
      if (hash(zip) !== m.archive.sha256) throw new ResearchError('Publication archive changed', 409);
      await mkdir(`/proc/self/fd/${parent.fd}/.exports`, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      const exports = await childDirectory(parent, '.exports'); let file;
      const info = await exports.stat();
      if (info.uid !== m.uid || info.mode & 0o077) { await exports.close(); throw new ResearchError('Unsafe exports directory', 409); }
      try { file = await open(`/proc/self/fd/${exports.fd}/${archiveTemporary(m)}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); await file.writeFile(zip); await file.sync();
        await descriptorCommand('python3', ['-c', RENAME, archiveTemporary(m), `${m.workspaceId}.zip`], exports, 10000);
        await exports.sync(); }
      finally { await file?.close(); await exports.close(); }
    }
    await directory.chown(m.uid, m.gid); await directory.chmod(0o2700);
    await verifyTree(directory, m, false); await syncDirectories(directory, m);
    await publicationCheckpoint('TEMP_DURABLE'); await publicationCheckpoint('BEFORE_RENAME');
    await descriptorCommand('python3', ['-c', RENAME, temp, m.workspaceId], parent, 10000);
    created = false; // Publication is never removed on later failure.
    await parent.sync(); await publicationCheckpoint('AFTER_RENAME');
  } catch (error) {
    if (created) { await discardPublicationTemporary(root, m); await discardPublicationArchive(root, m); }
    throw error;
  } finally { await directory?.close(); await parent.close(); }
}
