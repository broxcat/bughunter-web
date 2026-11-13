/** Derived evidence only. These records never grant authorization or confirm vulnerabilities. */
export type ReconFreshness = 'RECENT' | 'AGING' | 'STALE';
export type ReconEvidence = {
  id: string; sources: string[]; references: string[];
  firstSeenAt: string; lastSeenAt: string;
  confidence: 'OBSERVED' | 'INFERRED'; freshness: ReconFreshness; historical: boolean; inScope: boolean;
};
export type ResearchReconContext = {
  authenticatedRecon?: import('../authenticatedRecon').SafeAuthSurface[];
  assessment?: { assessmentMode: import('../assessment').AssessmentMode | null; authorizedSourceCount: number; sourceContentAvailable: false; sourceAnalysisPerformed: false; assessmentPolicyFile: 'assessment-policy.json' | null };
  assetGraph?: import('../reconGraph').ReconAssetGraph;
  scopeAssets?: Array<{ id: string; programId: string; originalValue: string; normalizedValue: string; format: string; formatSource?:string; type: string; assetValue: string; active: boolean }>;
  schemaVersion: 1; programId: string; scopeId: string; targetId: string; generatedAt: string;
  untrustedData: true; authorizationGranted: false; activeSuggestionsAllowed: boolean;
  sources: Array<{ id: string; scanId: string; targetId: string; tool: string; startedAt?: string; completedAt?: string; status: string; outcome?: string }>;
  assets: Array<ReconEvidence & { hostname?: string; ip?: string; url?: string; verification: 'DISCOVERED' | 'PROBED' }>;
  endpoints: Array<ReconEvidence & { url: string; method?: string; parameters: string[]; verification: 'DISCOVERED' | 'PROBED'; statusCode?: number; contentType?: string; authenticatedCrawl?: boolean; safeForActiveReview: boolean; contextObservations?:Array<{scanRunId:string;contextKey:string;label:string;responseClass:string;statusCode?:number;reference:string}> }>;
  technologies: Array<ReconEvidence & { name: string; asset: string; version?: string }>;
  observations: Array<ReconEvidence & { type: string; description: string; asset?: string; facts?: Record<string, unknown> }>;
  suggestions: Array<{ id: string; asset: string; reason: string; signals: string[]; observationIds: string[]; sources: string[]; confidence: 'LOW' | 'MEDIUM'; freshness: ReconFreshness; scopeId: string; scopeAssetId?: string; assetValue?: string; assetType?: string; mode: 'PASSIVE_REVIEW' | 'SCOPED_REVIEW'; score: number }>;
  warnings: string[];
  counts: { assets: number; endpoints: number; technologies: number; observations: number; sources: number; suggestions: number };
  truncated: boolean;
};
