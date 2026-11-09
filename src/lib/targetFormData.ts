import type { LegacyScopeText, StoredExecutionPolicy } from './programExecutionPolicy';
import type { DocumentedAsset, ScopeEntry } from './targetReview';

export interface ProgramData {
  id: string;
  companyName: string;
  platform: string | null;
  programUrl: string | null;
  updatedAt?: string;
  deletingAt?: string | null;
  assessmentMode?: 'BLACK_BOX' | 'WHITE_BOX';
  rewardCurrency: string;
  rewardLow: string | null;
  rewardMedium: string | null;
  rewardHigh: string | null;
  rewardCritical: string | null;
  requiredUserAgent: string;
  outOfScope: string[];
  qualifying: string[];
  nonQualifying: string[];
  scopeRules: string[];
  rulesOfEngagement: string | null;
  targets: { id: string; host: string; active: boolean }[];
  _count?: { scopeAssets: number };
  executionPolicies?: { version: number; policy: StoredExecutionPolicy }[];
  legacyPolicyReview?: {
    scopes: LegacyScopeText[];
    scopeFingerprint: string;
    scopeChanged: boolean;
    exclusions: string[];
    unconvertible: { index: number; value: string; reason: string }[];
    unrepresentedRules: string[];
  };
  scopeIn?: ScopeEntry[];
  expectedAssets?: string;
  historicalDocumentedAssets?: DocumentedAsset[];
  hunterHasUserAgent?: boolean;
  testAccounts?: { id: string; label: string; purpose: string; asset: string }[];
}
