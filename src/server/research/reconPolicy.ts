import { matchesHost, isExcluded } from '@/lib/bountyProgram';
import { assetAllowsUrl, assetAllowsHost } from '@/lib/scopeAssets';
import { assertExecutionUrl } from '@/server/execution';
import { discoveryState } from '@/server/recon/program';
import type { ResearchReconContext } from '@/lib/research/recon';
import { assertResearchTarget, researchIsPassive, type ResearchTarget } from './workspace';

/** Shared Recon-to-Research boundary. A plan is derived advice, never a second
 * authorization engine; legacy free-text restrictions require manual review. */
export function reconScopePolicy(target: ResearchTarget, scopeAssets: NonNullable<ResearchReconContext['scopeAssets']> = []) {
  const manualReview = Boolean(target.scope.scopeDetails?.trim() || target.scope.outOfScope?.trim());
  return {
    activeSuggestionsAllowed: !researchIsPassive(target) && !manualReview,
    warnings: [
      ...(manualReview ? ['Legacy free-text scope restrictions require manual review; suggestions are passive only. Additional prose restrictions are not interpreted as structured authorization.'] : []),
      ...(researchIsPassive(target) ? ['Program/wildcard console is passive only. Open an individually authorized host console before active investigation.'] : []),
    ],
    inScope(value: string) {
      try {
        const url = value.startsWith('http') ? new URL(value) : null;
        const host = url?.hostname ?? value;
        const boundary = target.scopeAsset ?? target.discoveredFromAsset;
        if (boundary) return boundary.active && (target.scopeAsset || host === target.host) && !isExcluded(host, target.program!.outOfScope) && (url ? assetAllowsUrl(boundary, value) : assetAllowsHost(boundary, host));
        if (target.contextOnly) {
          const legacyExclusions = target.scope.outOfScope?.toLowerCase().match(/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? [];
          return target.scope.status === 'APPROVED' && !legacyExclusions.some(r => matchesHost(host, r)) && !isExcluded(host, target.program!.outOfScope) && (scopeAssets.length ? scopeAssets.some(a => a.active && (url ? assetAllowsUrl(a, value) : assetAllowsHost(a, host))) : discoveryState(host, target.program!.scopeRules, target.program!.outOfScope) === 'VALIDATED');
        }
        assertResearchTarget(target, target.userId);
        if (host !== target.host) return false;
        if (url) {
          assertExecutionUrl(value, { targetId: target.id, host: target.host, requiredUserAgent: target.program!.requiredUserAgent, qualifying: target.program!.qualifying, nonQualifying: target.program!.nonQualifying });
          if (url.protocol !== `${target.scheme ?? 'https'}:` || Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== (target.scheme === 'http' ? 80 : 443)) return false;
        }
        return true;
      } catch { return false; }
    },
  };
}
