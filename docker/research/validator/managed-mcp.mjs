import { mkdir, readFile, writeFile, rename, chmod, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const claudeBurpServer = Object.freeze({ type: 'stdio', command: '/usr/local/bin/bughunter-burp-passive-mcp', args: [] });
// Dedicated managed file: user settings, credentials and transcripts are never rewritten.
export async function reconcileClaudeMcp(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (await realpath(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Error('UNSAFE_CONFIG_DIRECTORY');
  const file = join(directory, 'bughunter-mcp.json');
  const existingStat = await lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existingStat && (!existingStat.isFile() || existingStat.isSymbolicLink() || existingStat.uid !== process.getuid())) throw new Error('UNSAFE_CONFIG_FILE');
  const expected = JSON.stringify({ mcpServers: { bughunter_burp: claudeBurpServer } }, null, 2) + '\n';
  const existing = await readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing !== expected) {
    const temporary = file + '.' + randomUUID();
    await writeFile(temporary, expected, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  }
  await chmod(file, 0o600);
  return file;
}
