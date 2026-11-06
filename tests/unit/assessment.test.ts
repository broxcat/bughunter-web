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
  it('ignores retired current configuration but preserves historical snapshots', () => {
    const before=JSON.stringify(source);
    const captured=captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},[source]);
    expect(captured.assessmentMode).toBe('BLACK_BOX'); expect(captured.authorizedSources).toEqual([]);
    const historical=assessmentSnapshotFromRun({assessmentModeSnapshot:'WHITE_BOX',assessmentSourcesSnapshot:[source]});
    expect(historical.assessmentMode).toBe('WHITE_BOX');expect(historical.authorizedSources).toEqual([source]);
    expect(assessmentMarkdown(historical)).toContain('White-box mode is retired');expect(JSON.stringify(source)).toBe(before);
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
  it('documents the runtime evidence boundary',()=>{
    const current=assessmentMarkdown(captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},[source]));
    expect(current).toContain('No internal source material is assumed');expect(current).not.toContain(source.locator);
  });
});
