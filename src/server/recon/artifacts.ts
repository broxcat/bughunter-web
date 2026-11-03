import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { deduplicateArtifacts, normalizeArtifact, type ReconArtifactData, type ArtifactKind, type ArtifactSource } from '@/lib/reconArtifacts';
import type { AssetBoundary } from '@/lib/scopeAssets';
import { buildReconContext, type ReconRun } from '../research/reconContext';
import { expandAssetReconRuns } from '../research/reconInputs';

export const artifactSelect = { id: true, kind: true, canonicalKey: true, value: true, scopeState: true, verification: true, sources: true, firstSeenAt: true, lastSeenAt: true } as const;
export function artifactData(row: { id: string; kind: string; canonicalKey: string; value: unknown; scopeState: string; verification: string; sources: unknown; firstSeenAt: Date; lastSeenAt: Date }): ReconArtifactData {
  return { ...row, value: row.value as ReconArtifactData['value'], kind: row.kind as ArtifactKind, sources: row.sources as ArtifactSource[], scopeState: row.scopeState as ReconArtifactData['scopeState'], verification: row.verification as ReconArtifactData['verification'], firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString() };
}
export async function persistArtifacts(scanRunId: string, scopeAssetId: string, rows: ReconArtifactData[]) {
  for (const row of deduplicateArtifacts(rows)) {
    const canonicalKey = createHash('sha256').update(row.canonicalKey).digest('hex');
    await prisma.$transaction(async tx => {
      // Serialize incremental source merges, including the first concurrent insert.
      await tx.$queryRaw`SELECT id FROM "ScanRun" WHERE id=${scanRunId} FOR UPDATE`;
      const where = { scanRunId_kind_canonicalKey: { scanRunId, kind: row.kind, canonicalKey } };
      const existing = await tx.reconArtifact.findUnique({ where });
      const merged = deduplicateArtifacts([...(existing ? [{ ...artifactData(existing), canonicalKey: row.canonicalKey }] : []), row])[0];
      const data = { scopeAssetId, scopeState: merged.scopeState, verification: merged.verification, value: merged.value as Prisma.InputJsonValue, sources: merged.sources as unknown as Prisma.InputJsonValue, firstSeenAt: new Date(merged.firstSeenAt), lastSeenAt: new Date(merged.lastSeenAt) };
      await tx.reconArtifact.upsert({ where, create: { scanRunId, kind: row.kind, canonicalKey, ...data }, update: data });
    });
  }
}
/** One-time compatibility import. All later consumers use persisted artifacts. */
export async function ensureLegacyArtifacts(runId: string) {
  const run = await prisma.scanRun.findUnique({ where: { id: runId }, include: { scopeAsset: { include: { program: true } }, target: true, discoveries: true } });
  if (!run?.scopeAsset || run.artifactVersion >= 2 || ['RUNNING','QUEUED'].includes(run.status)) return;
  const logs = await prisma.$queryRaw<ReconRun['logs']>`SELECT id,left(line,16385) AS line,stream::text AS stream,"createdAt" FROM "ScanLog" WHERE "scanRunId"=${runId} ORDER BY "createdAt",id LIMIT 1000`;
  const context = buildReconContext({ programId: run.scopeAsset.programId, scopeId: run.scopeAsset.id, targetId: run.targetId, generatedAt: (run.finishedAt ?? run.createdAt).toISOString(),
    runs: expandAssetReconRuns([{ ...run, logs }]), inScope: () => false, activeSuggestionsAllowed: false });
  const rows: ReconArtifactData[] = [];
  const add = (kind: ArtifactKind, value: Record<string, unknown>, sources: string[], refs: string[], at: string, observed = false) => {
    for (const source of sources) {
      const tool = context.sources.find(s => s.id === source)?.tool ?? 'legacy';
      const row = normalizeArtifact(kind, value, { tool, sourceRef: refs[0] ?? `ScanRun:${run.id}`, observedAt: at }, run.scopeAsset!, run.scopeAsset!.program.outOfScope, observed ? 'OBSERVED' : 'DISCOVERED'); if (row) rows.push(row);
    }
  };
  for (const a of context.assets) add('hostname', { hostname: a.hostname! }, a.sources,a.references,a.lastSeenAt,a.verification === 'PROBED');
  for (const e of context.endpoints) { add('endpoint', { url: e.url, safeForActiveReview:e.safeForActiveReview, ...(e.method ? { method: e.method } : {}), ...(e.statusCode ? { statusCode: e.statusCode } : {}), ...(e.contentType ? { contentType: e.contentType } : {}) },e.sources,e.references,e.lastSeenAt,e.verification === 'PROBED'); for (const name of e.parameters) add('parameter',{url:e.url,name},e.sources,e.references,e.lastSeenAt); }
  for (const t of context.technologies) add('technology',{hostname:t.asset!,name:t.name},t.sources,t.references,t.lastSeenAt);
  for (const o of context.observations) add('observation',{hostname: o.asset?.startsWith('http') ? new URL(o.asset).hostname : o.asset ?? run.target.host,type:o.type,description:o.description},o.sources,o.references,o.lastSeenAt);
  await persistArtifacts(run.id,run.scopeAsset.id,rows);
  await prisma.scanRun.update({ where: { id: run.id }, data: { artifactVersion: 2 } });
}
export async function recordArtifact(scanRunId: string, asset: AssetBoundary & { id: string }, exclusions: string[], kind: ArtifactKind, value: Record<string,unknown>, source: ArtifactSource, verification?: ReconArtifactData['verification']) {
  const row = normalizeArtifact(kind,value,source,asset,exclusions,verification); if (row) await persistArtifacts(scanRunId,asset.id,[row]); return row;
}
