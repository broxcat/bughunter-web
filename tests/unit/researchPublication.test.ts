import { it, expect } from 'vitest';
import { mkdtemp, chmod, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publicationRoot, withPublicationLock } from '@/server/research/publicationLock';

it('rejects the filesystem root before any publication operation', async () => {
  await expect(publicationRoot('/', true)).rejects.toThrow(/Unsafe/);
});
it('rejects a world-writable fixture root without changing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-root-'));
  try {
    await chmod(root, 0o777);
    await expect(withPublicationLock(root, 'research_target', async () => {})).rejects.toThrow(/Unsafe/);
    expect((await lstat(root)).mode & 0o777).toBe(0o777);
  } finally { await rm(root, { recursive: true, force: true }); }
});
