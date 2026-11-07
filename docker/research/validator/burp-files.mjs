import { constants } from 'node:fs';
import { open, realpath, mkdir, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readRuntimeBinding } from './runtime-binding.mjs';
import { burpPolicySchema } from '../../../src/lib/research/burp.ts';
const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const child = (parent, name) => `/proc/self/fd/${parent.fd}/${name}`;
export async function readBounded(parent, name, max, immutable = false) {
  const file = await open(child(parent, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max || (immutable && (stat.uid !== 0 || stat.mode & 0o222))) throw new Error('UNSAFE_FILE');
    const buffer = Buffer.alloc(max + 1); let size = 0;
    while (size < buffer.length) { const r = await file.read(buffer, size, buffer.length - size, size); if (!r.bytesRead) break; size += r.bytesRead; }
    if (size > max) throw new Error('FILE_TOO_LARGE');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } finally { await file.close(); }
}
export async function openWorkspace() {
  const binding = await readRuntimeBinding();
  const cwd = await realpath(process.cwd());
  if(cwd !== '/workspaces/'+binding.workspaceId)throw new Error('RESEARCH_IDENTITY_DENIED');
  if (!/^\/workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cwd)) throw new Error('WORKSPACE_REQUIRED');
  let root = await open('/', dirFlags);
  try {
    for (const part of cwd.split('/').filter(Boolean)) { const next = await open(child(root, part), dirFlags); await root.close(); root = next; }
    const policy = burpPolicySchema.parse(JSON.parse(await readBounded(root, 'burp-policy.json', 8192, true)));
    if (policy.workspaceId !== cwd.split('/').at(-1)) throw new Error('WRONG_WORKSPACE');
    // Critical ground truth must still exist as immutable regular inputs.
    for (const name of ['AGENTS.md', 'scope.md', 'program-policy.md', 'target.json']) await readBounded(root, name, 1024 * 1024, true);
    return { root, policy };
  } catch { await root.close(); throw new Error('CONFIG_UNAVAILABLE'); }
}
export async function writeDiagnostic(root, value) {
  const research = await open(child(root, 'research'), dirFlags);
  const temp = `.burp-status-${randomUUID()}.tmp`;
  try {
    const file = await open(child(research, temp), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o660);
    try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); } finally { await file.close(); }
    await rename(child(research, temp), child(research, 'burp-status.json'));
  } finally { await unlink(child(research, temp)).catch(() => {}); await research.close(); }
}
export async function saveObservation(root, value) {
  const evidence = await open(child(root, 'evidence'), dirFlags);
  let burp, locked = false;
  try {
    await mkdir(child(evidence, 'burp'), { mode: 0o2770 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    burp = await open(child(evidence, 'burp'), dirFlags);
    // Serialize quota checks across gateway processes. Never recurse or follow
    // a mutable path. A crash leaves a harmless lock requiring operator removal.
    await mkdir(child(burp, '.write-lock'), { mode: 0o700 }); locked = true;
    const entries = await readdir(child(burp, '.'));
    if (entries.length >= 102 || entries.filter(name => name.endsWith('.json')).length >= 100) throw new Error('EVIDENCE_LIMIT');
    const text = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(text) > 8192) throw new Error('EVIDENCE_LIMIT');
    const name = `${randomUUID()}.json`;
    const file = await open(child(burp, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o660);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    return `evidence/burp/${name}`;
  } finally {
    if (locked) await rmdir(child(burp, '.write-lock'));
    await burp?.close(); await evidence.close();
  }
}
