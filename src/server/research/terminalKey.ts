import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
export async function readTerminalSigningKey() {
  const path = process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE ?? '/run/research-terminal/private.pem';
  if (!isAbsolute(path)) throw new Error('UNSAFE_SIGNING_KEY');
  // Runtime-mounted secret, never an application deployment artifact.
  const key = await open(/* turbopackIgnore: true */ path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await key.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2048 || stat.mode & 0o077) throw new Error('UNSAFE_SIGNING_KEY');
    return await key.readFile('utf8');
  } finally { await key.close(); }
}
