
import { createHash } from 'node:crypto';
import type { ImportPlatform, PlatformConnectionInput } from '@/lib/platformConnections';
import { decryptSecret } from '@/lib/crypto';
import { platformConnectionSchema } from '@/lib/platformConnections';
import { prisma } from '@/lib/prisma';
import { bugcrowd, hackerOne, intigriti, yesWeHack } from './adapters';
import type { ProgramPreview } from './normalize';
import { platformReader } from './transport';
import { ImportUnavailable, type Reader } from './types';

const adapters = [hackerOne, bugcrowd, intigriti, yesWeHack];
const TTL_MS = 120_000;
const CACHE_LIMIT = 64;
const cache = new Map<string, { value: ProgramPreview; expires: number }>();
const pending = new Map<string, Promise<ProgramPreview>>();

export function detectProgram(value: string, platform?: ImportPlatform) {
  // Inspect the original path before URL normalizes dot segments and escapes.
  if (!/^https:\/\/[a-z0-9.]+\/[a-z0-9_/-]+(?:[?#][^\s]*)?$/i.test(value)) return null;
  const url = URL.parse(value);
  if (!url) return null;
  for (const importer of adapters) {
    if (platform && importer.platform !== platform) continue;
    const reference = importer.detect(url);
    if (reference) return { importer, reference };
  }
  return null;
}

export async function readProgramPreview(value: string, read: Reader, platform?: ImportPlatform) {
  const detected = detectProgram(value, platform);
  if (!detected) throw new ImportUnavailable('manual');
  const { importer, reference } = detected;
  const program = await importer.fetchProgram(reference, read);
  const scope = await importer.fetchScope(reference, program, read);
  const rules = await importer.fetchRules(reference, program, read);
  return importer.normalize(reference, program.name, scope, rules);
}

export async function previewProgram(userId: string, input: { url: string; platform?: ImportPlatform; visibility?: 'public' | 'private' }) {
  const detected = input.visibility === 'private' ? null : detectProgram(input.url, input.platform);
  if (!detected) throw new ImportUnavailable('manual');
  const { reference } = detected;
  const row = reference.platform === 'YESWEHACK' ? null : await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: reference.platform } },
    select: { credentialCipher: true },
  });
  if (!row && reference.platform !== 'YESWEHACK') throw new ImportUnavailable('connection_required');
  const key = createHash('sha256').update(JSON.stringify([userId, reference.url, row?.credentialCipher])).digest('hex');
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  cache.delete(key);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  if (pending.size >= CACHE_LIMIT) throw new ImportUnavailable('temporarily_unavailable');
  let credential: PlatformConnectionInput | undefined;
  if (row) {
    try { credential = platformConnectionSchema.parse(JSON.parse(decryptSecret(row.credentialCipher))); }
    catch { throw new ImportUnavailable('connection_required'); }
  }
  const reader = platformReader(reference.platform, credential);
  const work = readProgramPreview(reference.url, reader.read, reference.platform).then(value => {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  }).finally(() => {
    reader.close();
    pending.delete(key);
  });
  pending.set(key, work);
  return work;
}
