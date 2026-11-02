import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ asset: vi.fn(), discoveries: vi.fn(), save: vi.fn(), stage: vi.fn(), stages: vi.fn(), finish: vi.fn(), command: vi.fn(), probe: vi.fn(), crawl: vi.fn(), enumerate: vi.fn(), persist: vi.fn(), dns: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { scopeAsset: { findUnique: mocks.asset }, hostDiscovery: { findMany: mocks.discoveries }, scanRun: { update: mocks.save }, reconPipelineStep: { createMany: mocks.stages, update: mocks.stage, updateMany: mocks.finish } } }));
vi.mock('@/server/scanners/runCommand', () => ({ runCommand: mocks.command }));
vi.mock('@/server/scanners/http', () => ({ probe: mocks.probe }));
vi.mock('@/server/scanners/discovery', () => ({ discoverCorpus: mocks.crawl, clearDiscoveryCorpus: vi.fn() }));
vi.mock('@/server/recon/program', () => ({ runProgramRecon: mocks.enumerate, persistProgramDiscovery: mocks.persist }));
vi.mock('node:dns/promises', () => ({ Resolver: class { resolveAny = mocks.dns; cancel() {} } }));
vi.mock('node:tls', async () => { const { EventEmitter } = await import('node:events'); return { connect: () => { const socket = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn(), getPeerCertificate: () => ({ fingerprint256: 'AB:CD', valid_from: 'Nov 1 00:00:00 2026 GMT', valid_to: 'Nov 1 00:00:00 2027 GMT' }) }); queueMicrotask(() => socket.emit('secureConnect')); return socket; } }; });
import { runAssetRecon } from '@/server/recon/assetPipeline';
import { withTargetExecution } from '@/server/execution';
import { detectScopeAsset } from '@/lib/scopeAssets';
let asset: ReturnType<typeof makeAsset>;
function makeAsset(value = 'app.example.test', type = 'WEB_APPLICATION') { const d = detectScopeAsset(value); return { id: 'asset', programId: 'program', ...d, type, active: true, assetValue: 'HIGH', program: { ownerId: 'owner', outOfScope: ['excluded.example.test'], deletingAt: null }, executionTarget: { scope: { status: 'APPROVED' } } }; }
function execute() { return withTargetExecution({ targetId: 'target', host: asset.format === 'URL' ? new URL(asset.normalizedValue).host : asset.normalizedValue, scopeAsset: asset, ...(asset.format === 'WILDCARD_DOMAIN' ? { programReconId: 'program' } : {}), requiredUserAgent: 'Fixture/1', qualifying: [], nonQualifying: [] }, () => runAssetRecon('scan')); }
beforeEach(() => {
  vi.resetAllMocks(); asset = makeAsset(); mocks.asset.mockImplementation(async () => asset); mocks.dns.mockResolvedValue([{ address: '192.0.2.1', type: 'A' }]);
  mocks.command.mockResolvedValue({ code: 0, timedOut: false }); mocks.enumerate.mockResolvedValue({ outcome: 'SUCCESS' });
  mocks.discoveries.mockResolvedValue([{ host: 'app.example.test' }, { host: 'excluded.example.test' }, { host: 'example.test' }, { host: 'outside.test' }]);
  mocks.probe.mockImplementation(async (url: string) => ({ url, method: 'GET', status: 200, body: 'PRIVATE_BODY_NOT_EXPORTED', headers: { 'content-type': 'text/html', server: 'nginx' } }));
  mocks.crawl.mockImplementation(async (ctx: { baseUrl: string }) => ({ html: '<script src="app.js"></script><form method="POST" action="profile"><input name="email"></form>', urls: [new URL('api/items?q=private', ctx.baseUrl).toString()], authenticated: false, pages: [{ url: ctx.baseUrl, status: 200, headers: { 'content-type': 'text/html', server: 'nginx' }, body: 'PRIVATE_BODY_NOT_EXPORTED' }], execution: { successfulRequests: 1, failedRequests: 0, issues: [] } }));
});
describe('asset pipeline execution (controlled collectors, no real CLI/model claims)', () => {
  it('uses existing tools for broad Web Application assets, records true observed data and skips automatic snapshot replacement', async () => {
    expect(await execute()).toEqual({ outcome: 'SUCCESS' });
    expect(mocks.command.mock.calls.map(c => c[0])).toEqual(['httpx', 'nmap', 'katana']);
    const data = mocks.save.mock.calls.at(-1)![0].data; expect(data.assetResults.hosts[0]).toMatchObject({ hostname: 'app.example.test', dns: ['192.0.2.1'], http: expect.arrayContaining([expect.objectContaining({ statusCode: 200 })]) });
    expect(JSON.stringify(data)).not.toContain('PRIVATE_BODY_NOT_EXPORTED');
    expect(mocks.stage.mock.calls.some(c => c[0].where.scanRunId_name.name === 'Research Context' && c[0].data.state === 'SKIPPED')).toBe(true);
  });
  it('uses guarded URL/API discovery with documentation seeds inside the original path/port boundary', async () => {
    asset = makeAsset('https://app.example.test:8443/api/', 'API');
    expect(await execute()).toEqual({ outcome: 'SUCCESS' }); expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.crawl.mock.calls[0][1]).toEqual(expect.arrayContaining(['https://app.example.test:8443/api/openapi.json', 'https://app.example.test:8443/api/swagger.json']));
    expect(mocks.stage.mock.calls.some(c => c[0].where.scanRunId_name.name === 'Ports' && c[0].data.state === 'SKIPPED')).toBe(true);
  });
  it('keeps every wildcard discovery under the parent and filters apex, exclusions and neighbours before network work', async () => {
    asset = makeAsset('*.example.test', 'WILDCARD'); expect(await execute()).toEqual({ outcome: 'SUCCESS' }); expect(mocks.enumerate).toHaveBeenCalledOnce();
    expect(mocks.dns).toHaveBeenCalledExactlyOnceWith('app.example.test'); expect(mocks.save.mock.calls.at(-1)![0].data.assetResults.scopeAssetId).toBe('asset');
  });
  it('retains partial evidence and marks the failing stage instead of claiming complete Recon', async () => {
    mocks.command.mockImplementation(async (name: string) => ({ code: name === 'katana' ? 1 : 0, timedOut: false }));
    expect(await execute()).toMatchObject({ outcome: 'PARTIAL' }); expect(mocks.save).toHaveBeenCalled();
    expect(mocks.stage.mock.calls.some(c => c[0].where.scanRunId_name.name === 'Crawling' && c[0].data.state === 'FAILED')).toBe(true);
  });
  it('refuses revoked asset authorization before any collector or scanner starts', async () => {
    asset.active = false; await expect(execute()).rejects.toThrow('authorization'); expect(mocks.command).not.toHaveBeenCalled(); expect(mocks.probe).not.toHaveBeenCalled();
  });
});
