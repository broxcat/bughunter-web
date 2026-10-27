import { constants } from 'node:fs';
import { open, readdir, mkdir, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { childPath } from './console-files.mjs';
const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
export async function saveConsoleObservation(root, value) {
  const requests = await open(childPath(root, 'requests'), flags);
  let locked = false, burp;
  try {
    burp = await open(childPath(requests, 'burp'), flags);
    await mkdir(childPath(burp, '.write-lock'), { mode: 0o700 }); locked = true;
    if ((await readdir(childPath(burp, '.'))).filter(n => n.endsWith('.json')).length >= 100) throw new Error('EVIDENCE_LIMIT');
    const text = JSON.stringify(value, null, 2); if (Buffer.byteLength(text) > 8192) throw new Error('EVIDENCE_LIMIT');
    const name = `${randomUUID()}.json`, file = await open(childPath(burp, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o660);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    return `requests/burp/${name}`;
  } finally { if (locked) await rmdir(childPath(burp, '.write-lock')); await burp?.close(); await requests.close(); }
}
