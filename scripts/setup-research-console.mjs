#!/usr/bin/env node
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, lstat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
const index = process.argv.indexOf('--root'), root = index >= 0 ? process.argv[index + 1] : process.env.RESEARCH_HOST_ROOT;
if (!root || !isAbsolute(root)) throw new Error('Pass --root with the static absolute Docker-host Research directory.');
for (const dir of [root, 'data/research-terminal', 'data/research-ssh']) { await mkdir(dir, { recursive: true, mode: 0o700 }); if (!(await lstat(dir)).isDirectory() || (await lstat(dir)).isSymbolicLink()) throw new Error('Unsafe operator directory'); }
const privatePath = resolve('data/research-terminal/private.pem'), publicPath = resolve('data/research-terminal/public.pem');
let key;
try { const f = await open(privatePath, constants.O_RDONLY | constants.O_NOFOLLOW); try { key = createPrivateKey(await f.readFile()); } finally { await f.close(); } }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  const pair = generateKeyPairSync('ed25519'), f = await open(privatePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })); } finally { await f.close(); }
  key = pair.privateKey;
}
const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' });
try { const f = await open(publicPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); try { await f.writeFile(publicKey); } finally { await f.close(); } }
catch (e) { if (e.code !== 'EEXIST') throw e; const f = await open(publicPath, constants.O_RDONLY | constants.O_NOFOLLOW); try { if (await f.readFile('utf8') !== publicKey) throw new Error('Signing key mismatch; refusing to rotate'); } finally { await f.close(); } }
console.log(`Research host root: ${root}\nDedicated Ed25519 signing files ready (no Auth.js/Codex/Burp credential copied).\nSet RESEARCH_HOST_ROOT in .env to this same path. SSH public keys are optional under data/research-ssh/authorized_keys.`);
