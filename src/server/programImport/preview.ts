import type { ImportPlatform } from '@/lib/platformConnections';
import { bugcrowd, hackerOne, intigriti, yesWeHack } from './adapters';
import { ImportUnavailable, type Reader } from './types';

const adapters = [hackerOne, bugcrowd, intigriti, yesWeHack];

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
