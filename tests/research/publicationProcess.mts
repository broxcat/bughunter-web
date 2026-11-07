// Disposable process-death fixture. No CLI/model/network target invocation.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withPublicationTestHooks, type PublicationPhase } from '../../src/server/research/publicationTestHooks';
import { ensureTargetConsole } from '../../src/server/research/consoleWorkspace';
import { createResearchSession } from '../../src/server/research/sessions';
const [owner, target, phase, layout] = process.argv.slice(2);
assert(process.env.NODE_ENV === 'test');
assert(new URL(process.env.DATABASE_URL!).searchParams.get('schema')?.startsWith('provision_'));
assert(process.env.RESEARCH_CONSOLE_ROOT?.startsWith(join(tmpdir(), 'bh-issue8-publication-')));
const result = await withPublicationTestHooks({ [phase as PublicationPhase]: async () => {
  process.send?.({ phase });
  await new Promise(() => {});
} }, async () => layout === 'legacy' ? { session: await createResearchSession(owner, target) } : ensureTargetConsole(owner, target));

const { prisma } = await import('../../src/lib/prisma');
process.send?.({ sessionId: result.session.id });
await prisma.$disconnect();
process.disconnect?.();
