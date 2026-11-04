import { z } from 'zod';

export const assessmentModes = ['BLACK_BOX', 'WHITE_BOX'] as const;
export type AssessmentMode = typeof assessmentModes[number];
export const assessmentSourceKinds = ['GIT_REPOSITORY', 'SOURCE_ARCHIVE', 'API_SPECIFICATION', 'ARCHITECTURE_DOCUMENTATION', 'CONFIGURATION', 'OTHER'] as const;
export type AssessmentSourceKind = typeof assessmentSourceKinds[number];
// Runtime ReconArtifact remains RUNTIME. Future internal evidence must declare origin.
export type EvidenceOrigin = 'RUNTIME' | 'SOURCE' | 'SPECIFICATION' | 'DOCUMENTATION' | 'CONFIGURATION';
export const assessmentModeLabel = (mode?: string | null) => mode === 'BLACK_BOX' ? 'Black-box' : mode === 'WHITE_BOX' ? 'White-box' : 'Legacy / mode not captured';
export const assessmentSourceKindLabel = (kind: string) => ({ GIT_REPOSITORY: 'Git repository', SOURCE_ARCHIVE: 'Source archive', API_SPECIFICATION: 'API specification', ARCHITECTURE_DOCUMENTATION: 'Architecture documentation', CONFIGURATION: 'Configuration', OTHER: 'Other' }[kind] ?? 'Other');

const obviousSecret = /-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:github_pat_|gh[pousr]_|glpat-|sk-(?:or-v1-)?)[a-z0-9_-]{8,}|\bBearer\s+\S+|\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+|\beyJ[a-z0-9_-]+\.eyJ[a-z0-9_-]+\./i;
const metadataText = (max: number) => z.string().trim().max(max).refine(v => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v), 'Control characters are not allowed').refine(v => !obviousSecret.test(v), 'Credentials must not be stored in source metadata');

export function normalizeAssessmentPath(value: string): string {
  const path = value.trim().replaceAll('\\', '/');
  if (!path || path.length > 500 || /[\x00-\x1f\x7f:]/.test(path) || path.startsWith('/') || /%(?:2e|2f|5c|00)/i.test(path) || path.split('/').includes('..') || obviousSecret.test(path)) throw new Error('Use repository-relative paths without traversal or credentials');
  const normalized = path.split('/').filter(segment => segment && segment !== '.').join('/');
  if (!normalized) throw new Error('A repository-relative path is required');
  return normalized + (path.endsWith('/') ? '/' : '');
}
const pathSchema = z.string().transform((value, ctx) => { try { return normalizeAssessmentPath(value); } catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message }); return z.NEVER; } });
const pathsSchema = z.array(pathSchema).max(100).transform(paths => [...new Set(paths)].sort());

export function normalizeAssessmentLocator(value: string): string {
  const locator = value.trim();
  if (!locator || locator.length > 2048 || /[\x00-\x20\x7f]/.test(locator) || obviousSecret.test(locator)) throw new Error('Use a non-secret source URL or relative source identifier');
  if (/^[a-z][a-z0-9+.-]*:/i.test(locator)) {
    let url: URL; try { url = new URL(locator); } catch { throw new Error('Invalid source URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('Source URLs must use HTTP(S) without userinfo, query parameters or fragments');
    return url.toString();
  }
  return normalizeAssessmentPath(locator);
}
const locatorSchema = z.string().transform((value, ctx) => { try { return normalizeAssessmentLocator(value); } catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message }); return z.NEVER; } });
const referenceSchema = metadataText(200).min(1).refine(value => !/[\s~^:?*\[\\]/.test(value) && !value.includes('..') && !value.includes('@{') && !value.includes('//') && !value.startsWith('-') && !value.endsWith('/') && value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')), 'Invalid branch or revision reference').nullable();
const sourceFields = {
  label: metadataText(120).min(1), kind: z.enum(assessmentSourceKinds), locator: locatorSchema,
  reference: referenceSchema, includePaths: pathsSchema, excludePaths: pathsSchema,
  active: z.boolean(), notes: metadataText(2000).nullable(),
};
export const assessmentSourceSchema = z.strictObject({ ...sourceFields, reference: referenceSchema.default(null), includePaths: pathsSchema.default([]), excludePaths: pathsSchema.default([]), active: z.boolean().default(true), notes: sourceFields.notes.default(null) });
export const assessmentSourceUpdateSchema = z.strictObject(sourceFields).partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
export const assessmentModeChangeSchema = z.strictObject({ assessmentMode: z.enum(assessmentModes), confirmed: z.boolean().optional() });

export type AssessmentSourceInput = z.infer<typeof assessmentSourceSchema>;
export type AuthorizedSourceMetadata = {
  id: string; label: string; kind: AssessmentSourceKind; locator: string; reference: string | null;
  includePaths: string[]; excludePaths: string[]; updatedAt: string; contentAvailable: false;
  evidenceOrigin: Exclude<EvidenceOrigin, 'RUNTIME'>;
};
export type AssessmentSnapshot = {
  assessmentMode: AssessmentMode | null; authorizedSources: AuthorizedSourceMetadata[];
  sourceContentAvailable: false; sourceAnalysisPerformed: false;
  networkAuthorizationSource: 'ScopeAsset'; sourceAuthorizationSeparate: true;
};
type SourceRecord = Omit<AuthorizedSourceMetadata, 'updatedAt' | 'contentAvailable' | 'evidenceOrigin'> & { updatedAt: Date | string; active?: boolean };
const sourceOrigin = (kind: AssessmentSourceKind): AuthorizedSourceMetadata['evidenceOrigin'] => kind === 'API_SPECIFICATION' ? 'SPECIFICATION' : kind === 'ARCHITECTURE_DOCUMENTATION' ? 'DOCUMENTATION' : kind === 'CONFIGURATION' ? 'CONFIGURATION' : 'SOURCE';
const snapshot = (assessmentMode: AssessmentMode | null, authorizedSources: AuthorizedSourceMetadata[]): AssessmentSnapshot => ({ assessmentMode, authorizedSources, sourceContentAvailable: false, sourceAnalysisPerformed: false, networkAuthorizationSource: 'ScopeAsset', sourceAuthorizationSeparate: true });

/** Captures data authorization only. Never feed these locators into a network guard. */
export function captureAssessmentSnapshot(program: { assessmentMode?: AssessmentMode; assessmentSources?: SourceRecord[] }, sources = program.assessmentSources ?? []): AssessmentSnapshot {
  const mode = program.assessmentMode ?? 'BLACK_BOX';
  const authorized = mode === 'WHITE_BOX' ? sources.filter(source => source.active !== false).map(source => ({
    id: source.id, label: source.label, kind: source.kind, locator: source.locator, reference: source.reference,
    includePaths: [...source.includePaths], excludePaths: [...source.excludePaths], updatedAt: new Date(source.updatedAt).toISOString(),
    contentAvailable: false as const, evidenceOrigin: sourceOrigin(source.kind),
  })).sort((a, b) => a.id.localeCompare(b.id)) : [];
  return snapshot(mode, authorized);
}

/** Reads an execution's immutable columns. Missing historical data stays unknown. */
export function assessmentSnapshotFromRun(run?: { assessmentModeSnapshot?: AssessmentMode | null; assessmentSourcesSnapshot?: unknown } | null): AssessmentSnapshot {
  const mode = run?.assessmentModeSnapshot ?? null;
  return snapshot(mode, mode === 'WHITE_BOX' && Array.isArray(run?.assessmentSourcesSnapshot) ? run.assessmentSourcesSnapshot as AuthorizedSourceMetadata[] : []);
}
const markdownText = (value: string) => value.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').replace(/([\\`*_{}\[\]<>|#])/g, '\\$1');
export function assessmentMarkdown(context: AssessmentSnapshot): string {
  if (!context.assessmentMode) return '## Assessment Mode\n\nLegacy / mode not captured. No source-assisted analysis is evidenced by this metadata.\n';
  if (context.assessmentMode === 'BLACK_BOX') return '## Assessment Mode\n\nBlack-box.\n\nThis run uses authorized externally observable evidence.\nNo internal source material is assumed.\nSource authorization does not expand network authorization.\n';
  return '## Assessment Mode\n\nWhite-box.\n\nAuthorized source metadata is available for later source-assisted analysis.\nSource authorization does not expand network authorization.\n\n### Authorized Sources\n\n' + (context.authorizedSources.map(source => `- ${markdownText(source.label)} — ${assessmentSourceKindLabel(source.kind)}${source.reference ? ` — ref ${markdownText(source.reference)}` : ''}`).join('\n') || 'No effective sources registered.') + '\n\nSource content available: false.\nNo source-assisted analysis was executed by this Recon run.\n';
}
