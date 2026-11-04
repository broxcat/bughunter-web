import { describe, expect, it } from 'vitest';
import { assessmentModeChangeSchema, assessmentSourceSchema, assessmentSourceUpdateSchema, captureAssessmentSnapshot, assessmentSnapshotFromRun, assessmentMarkdown, normalizeAssessmentPath, normalizeAssessmentLocator } from '@/lib/assessment';
const source = { id: 'source-a', label: 'Backend', kind: 'GIT_REPOSITORY' as const, locator: 'https://git.example.test/acme/backend', reference: 'main', includePaths: ['src/'], excludePaths: ['tests/'], active: true, updatedAt: new Date('2026-11-04T12:00:00Z') };
describe('Assessment data authorization foundation', () => {
  it('defaults only new configuration to Black-box; old runs stay unknown', () => {
    expect(captureAssessmentSnapshot({}).assessmentMode).toBe('BLACK_BOX');
    expect(captureAssessmentSnapshot({ assessmentMode: 'BLACK_BOX' }, [source]).authorizedSources).toEqual([]);
    expect(assessmentSnapshotFromRun().assessmentMode).toBeNull();
    expect(assessmentMarkdown(assessmentSnapshotFromRun())).toContain('Legacy / mode not captured');
    expect(assessmentModeChangeSchema.safeParse({ assessmentMode: 'GREY_BOX' }).success).toBe(false);
  });
  it('captures only effective metadata, with provenance and no implied source content', () => {
    const records = [source, { ...source, id: 'source-b', active: false }];
    const captured = captureAssessmentSnapshot({ assessmentMode: 'WHITE_BOX' }, records);
    expect(captured).toMatchObject({ assessmentMode: 'WHITE_BOX', networkAuthorizationSource: 'ScopeAsset', sourceAuthorizationSeparate: true, sourceAnalysisPerformed: false, sourceContentAvailable: false });
    expect(captured.authorizedSources).toEqual([{ id: source.id, label: source.label, kind: source.kind, locator: source.locator, reference: 'main', includePaths: ['src/'], excludePaths: ['tests/'], updatedAt: source.updatedAt.toISOString(), contentAvailable: false, evidenceOrigin: 'SOURCE' }]);
    records[0].includePaths.push('new/'); expect(captured.authorizedSources[0].includePaths).toEqual(['src/']); records[0].includePaths.pop();
    expect(captureAssessmentSnapshot({ assessmentMode: 'WHITE_BOX' }, [...records].reverse())).toEqual(captured);
    expect(assessmentSnapshotFromRun({ assessmentModeSnapshot: 'WHITE_BOX', assessmentSourcesSnapshot: captured.authorizedSources })).toEqual(captured);
    expect(captureAssessmentSnapshot({ assessmentMode: 'BLACK_BOX' }, records).authorizedSources).toEqual([]);
    expect(records[0].active).toBe(true);
  });
  it.each(['../', '../../secret', '/etc/passwd', '\\etc\\passwd', 'C:\\secret', './C:/secret', '.\\C:\\secret', 'file:///etc/passwd', 'src/../secret', 'src/\x00x', 'src/%2e%2e/secret', '//server/share'])('rejects source path traversal/absolute %s', path => expect(() => normalizeAssessmentPath(path)).toThrow());
  it('normalizes paths without accessing files, and deduplicates bounded lists', () => {
    expect(normalizeAssessmentPath(' packages\\api\\ ')).toBe('packages/api/');
    const input = assessmentSourceSchema.parse({ label: 'Backend', kind: 'GIT_REPOSITORY', locator: source.locator, includePaths: ['src/', 'src/', 'packages\\api\\'] });
    expect(input).toMatchObject({ active: true, reference: null, notes: null, includePaths: ['packages/api/', 'src/'], excludePaths: [] });
    expect(assessmentSourceSchema.safeParse({ ...input, includePaths: Array(101).fill('src/') }).success).toBe(false);
    expect(assessmentSourceUpdateSchema.parse({ active: false })).toEqual({ active: false });
    expect(assessmentSourceUpdateSchema.safeParse({}).success).toBe(false);
  });
  it.each(['https://user:password@example.test/repo.git', 'https://user@example.test/repo.git', 'https://example.test/repo?token=abc', 'https://example.test/repo?%74oken=abc', 'https://example.test/repo#token=abc', 'ssh://git@example.test/repo', 'file:///etc/passwd', 'https://example.test/repo/ghp_abcdefghijklmno', 'https://example.test/repo\x00'])('rejects credential-bearing or unsupported locator %s', locator => expect(() => normalizeAssessmentLocator(locator)).toThrow());
  it('accepts source classifications and relative identifiers without opening or fetching', () => {
    expect(normalizeAssessmentLocator(' bundles\\backend.zip ')).toBe('bundles/backend.zip');
    for (const kind of ['GIT_REPOSITORY', 'SOURCE_ARCHIVE', 'API_SPECIFICATION', 'ARCHITECTURE_DOCUMENTATION', 'CONFIGURATION', 'OTHER']) expect(assessmentSourceSchema.safeParse({ label: 'Source', kind, locator: source.locator }).success).toBe(true);
  });
  it.each(['../main', 'refs//main', 'main.lock', 'main~1', 'main@{0}', 'my branch', '-main', 'refs/heads/.hidden'])('rejects invalid reference %s', reference => expect(assessmentSourceSchema.safeParse({ label: 'Source', kind: 'GIT_REPOSITORY', locator: source.locator, reference }).success).toBe(false));
  it('bounds metadata and rejects unexpected source contents/credentials', () => {
    const input = { label: 'Source', kind: 'GIT_REPOSITORY', locator: source.locator };
    for (const extra of [{ label: 'x'.repeat(121) }, { reference: 'a'.repeat(201) }, { notes: 'a'.repeat(2001) }, { apiKey: 'private' }, { content: 'source code' }, { notes: 'token=private' }]) expect(assessmentSourceSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it('documents the source/network boundary and never claims source analysis', () => {
    const white = assessmentMarkdown(captureAssessmentSnapshot({ assessmentMode: 'WHITE_BOX' }, [source]));
    expect(white).toContain('Source authorization does not expand network authorization'); expect(white).toContain('No source-assisted analysis was executed'); expect(white).toContain('Backend — Git repository — ref main');
    expect(assessmentMarkdown(captureAssessmentSnapshot({}))).toContain('No internal source material is assumed');
    expect(white).not.toContain('https://git.');
  });
});
