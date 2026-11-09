
import { detectScopeAsset, type AssetFormat } from '@/lib/scopeAssets';
import { structuredExclusionSchema, storedExecutionPolicySchema } from '@/lib/programExecutionPolicy';
import type { ImportPlatform } from '@/lib/platformConnections';

export type ProgramReference = { platform: ImportPlatform; handle: string; url: string };
export type Rule = { text: string; assetRef?: string };
export type RawAsset = {
  id?: string; value: string | null; type: string; kind: 'WEB' | 'NON_WEB' | 'UNKNOWN';
  disposition: 'IN' | 'OUT' | 'UNKNOWN'; instruction?: string | null;
};
type PreviewAsset = {
  ref: string; originalValue: string | null; sourceType: string; normalizedValue: string | null;
  format: AssetFormat | null; automatable: boolean; reason?: string;
};
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function sortedUnique<T>(items: T[]) {
  return [...new Map(items.map(item => [JSON.stringify(item), item])).entries()].sort(([a], [b]) => order(a, b)).map(([, value]) => value);
}

function boundary(value: string | null) {
  if (!value || /[\\]/.test(value) || /\/\.{1,2}(?:\/|$)/.test(value)) return null;
  try {
    const result = detectScopeAsset(value);
    if (result.format === 'URL' && new URL(result.normalizedValue).hostname.includes('*')) return null;
    return result;
  } catch { return null; }
}

export function normalizeProgram(reference: ProgramReference, name: string, rawAssets: RawAsset[], rawRules: Rule[]) {
  const scopeIn: PreviewAsset[] = [], scopeOut: PreviewAsset[] = [];
  const nonAutomatable: PreviewAsset[] = [], unrepresentedAssets: PreviewAsset[] = [];
  const exclusions = new Set<string>();
  const rules = [...rawRules];
  const assets = rawAssets.map(raw => {
    const detected = boundary(raw.value);
    const exclusion = detected && detected.format !== 'HOSTNAME' && structuredExclusionSchema.safeParse(detected.normalizedValue).success
      ? detected.normalizedValue : null;
    return { raw, detected, exclusion };
  });
  const denied = new Set(assets.filter(asset => asset.raw.disposition === 'OUT').map(({ raw, detected }) => detected?.normalizedValue ?? raw.value));
  const hasProgramProse = rules.some(rule => !rule.assetRef && rule.text.trim()) ||
    assets.some(({ raw, exclusion }) => raw.disposition !== 'IN' && !exclusion);

  for (const { raw, detected, exclusion } of assets) {
    const ref = raw.id ?? JSON.stringify([raw.type, raw.value]);
    const item: PreviewAsset = {
      ref, originalValue: raw.value, sourceType: raw.type, normalizedValue: detected?.normalizedValue ?? null,
      format: detected?.format ?? null, automatable: false,
    };
    if (raw.instruction?.trim()) rules.push({ assetRef: ref, text: raw.instruction });
    if (raw.disposition === 'OUT') {
      if (exclusion) exclusions.add(exclusion);
      else rules.push({ assetRef: ref, text: 'Unrepresented exclusion: ' + (raw.value ?? raw.type) });
      scopeOut.push(item);
      continue;
    }
    if (raw.kind === 'NON_WEB' || (raw.kind === 'WEB' && (detected?.format === 'IP' || detected?.format === 'CIDR'))) {
      nonAutomatable.push({ ...item, reason: 'Unsupported asset for automated testing' });
      continue;
    }
    let reason: string | undefined;
    if (raw.disposition !== 'IN' || raw.kind !== 'WEB' || !detected?.executable) reason = 'Ambiguous eligibility, type or asset boundary';
    else if (denied.has(detected.normalizedValue)) reason = 'Explicit scope exclusion takes precedence';
    else if (raw.instruction?.trim() || rawRules.some(rule => rule.assetRef === ref)) reason = 'Asset-specific instructions require review';
    else if (detected.format === 'WILDCARD_DOMAIN' && hasProgramProse) reason = 'Review prose for exceptions to this wildcard';
    else if (detected.format === 'URL' && new URL(detected.normalizedValue).pathname !== '/') reason = 'Review exact URL path before allowing a path prefix';
    if (reason) {
      unrepresentedAssets.push({ ...item, reason });
      rules.push({ assetRef: ref, text: reason + ': ' + (raw.value ?? raw.type) });
    } else scopeIn.push({ ...item, automatable: true });
  }

  const unrepresentedRules = sortedUnique(rules.filter(rule => rule.text.trim()));
  const policy = storedExecutionPolicySchema.parse({
    reviewState: 'IMPORT_DRAFT', automationAllowed: false, requiredUserAgent: null, requiredHeaders: [],
    exclusions: [...exclusions].sort(order), requestsPerSecond: null, maxConcurrency: null, forbiddenCategories: [],
    sourceSnapshot: {
      url: reference.url,
      rules: unrepresentedRules.filter(rule => !rule.assetRef).map(rule => rule.text).join('\n\n'),
      unrepresentedRules: unrepresentedRules.map(rule => rule.assetRef ? '[' + rule.assetRef + '] ' + rule.text : rule.text),
    },
  });
  return {
    ...reference, name, scopeIn: sortedUnique(scopeIn), scopeOut: sortedUnique(scopeOut),
    nonAutomatable: sortedUnique(nonAutomatable), unrepresentedAssets: sortedUnique(unrepresentedAssets),
    unrepresentedRules, policy,
  };
}

export type ProgramPreview = ReturnType<typeof normalizeProgram>;
