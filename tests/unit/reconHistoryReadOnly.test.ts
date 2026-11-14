import { beforeEach, describe, expect, it, vi } from 'vitest';
const writes = vi.hoisted(() => ({ transaction: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), executeRaw: vi.fn(), queryRaw: vi.fn() }));
const reads = vi.hoisted(() => ({ asset: vi.fn(), scans: vi.fn(), archived: vi.fn(), published: vi.fn(), one: vi.fn(), groupBy: vi.fn() }));
vi.mock('@/lib/prisma', () => {
  const writable = { create: writes.create, update: writes.update, upsert: writes.upsert, updateMany: writes.update, createMany: writes.create };
  return { prisma: {
    $transaction: writes.transaction, $executeRaw: writes.executeRaw, $queryRaw: writes.queryRaw,
    scopeAsset: { findFirst: reads.asset, ...writable },
    scanRun: { findMany: reads.scans, findUnique: vi.fn(), ...writable },
    reconHistoryRun: { findMany: vi.fn((args: { where: { scanReferenceId?: unknown } }) => args.where.scanReferenceId ? reads.published(args) : reads.archived(args)), findUnique: reads.one, ...writable },
    reconSurfaceSeen: { groupBy: reads.groupBy, ...writable },
    researchCoverage: { findMany: vi.fn(), ...writable }, researchCoverageEvent: writable, reconSurface: writable,
  } };
});
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'owner' } })) }));
import { GET } from '@/app/api/scope-assets/[id]/history/route';

const run = (id: string, day: number) => ({ id, status: 'COMPLETED', outcome: 'SUCCESS', createdAt: new Date(`2026-11-0${day}T00:00:00Z`) });
describe('Recon history GET is read-only (B5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.asset.mockResolvedValue({ id: 'asset1' });
    reads.scans.mockResolvedValue([run('run2', 2), run('run1', 1)]);
    reads.archived.mockResolvedValue([]);
    reads.published.mockResolvedValue([{ scanReferenceId: 'run1' }]);
    reads.one.mockResolvedValue(null);
    reads.groupBy.mockResolvedValue([]);
  });
  it('compares retained runs without publishing history or flagging coverage', async () => {
    const response = await GET(new Request('http://app.test/api/scope-assets/asset1/history'), { params: Promise.resolve({ id: 'asset1' }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pendingPublication).toEqual(['run2']);
    expect(body.currentId).toBe('run2');
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
  });
  it('still refuses another owner\'s asset', async () => {
    reads.asset.mockResolvedValue(null);
    const response = await GET(new Request('http://app.test/api/scope-assets/asset1/history'), { params: Promise.resolve({ id: 'asset1' }) });
    expect(response.status).toBe(404);
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
  });
});
