import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { researchAuthorizationSnapshot, researchTargetSelect } from '@/server/research/workspace';
import { hypothesisSnapshot } from '@/server/research/hypotheses';
import { hypothesesDocumentSchema } from '@/lib/research/hypotheses';

type Db = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Research sessions are no longer created by the application. Tests seed the
 * historical rows that existing deployments still hold, optionally with an
 * on-disk legacy workspace directory for reference-based evidence.
 */
export async function createHistoricalSession(db: Db, userId: string, targetId: string, options: { root?: string; data?: Partial<Prisma.ResearchSessionUncheckedCreateInput> } = {}) {
  const target = await db.target.findUniqueOrThrow({ where: { id: targetId }, select: researchTargetSelect });
  const session = await db.researchSession.create({ data: {
    userId, targetId, workspaceId: randomUUID(), status: 'READY', targetHost: target.host,
    programName: target.program?.companyName ?? target.host, scopeMarkdown: '# Historical scope',
    authorizationSnapshot: json(researchAuthorizationSnapshot(target)), ...options.data,
  } });
  if (options.root) for (const directory of ['evidence', 'research']) await mkdir(join(options.root, session.workspaceId, directory), { recursive: true, mode: 0o700 });
  return session;
}

/** Stores one hypothesis exactly as the retired workspace import did. */
export async function createHistoricalHypothesis(db: Db, sessionId: string, input: unknown) {
  const version = input && typeof input === 'object' && 'targetId' in input ? 2 : 1;
  const [parsed] = hypothesesDocumentSchema.parse({ version, sessionId, hypotheses: [input] }).hypotheses;
  const snapshot = hypothesisSnapshot(parsed);
  const row = await db.researchHypothesis.create({ data: {
    sessionId, ...snapshot, evidenceFor: json(snapshot.evidenceFor), evidenceAgainst: json(snapshot.evidenceAgainst),
    researchData: snapshot.researchData ? json(snapshot.researchData) : undefined,
    contentSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), revision: 1,
  } });
  await db.researchHypothesisRevision.create({ data: { hypothesisId: row.id, revision: 1, snapshot: json(snapshot), source: 'WORKSPACE_IMPORT' } });
  return row;
}
