import { describe, expect, it } from 'vitest';
import { researchReviewInput } from '@/lib/research/humanReview';
import { canPrepareResearchHunt, researchTier } from '@/lib/research/workflow';
import { semanticRank } from '@/lib/research/semanticRank';
import type { ResearchPlanPanelState, ResearchPlanView } from '@/lib/researchPlanView';

describe('guided Research workflow', () => {
  const plan = { id: 'plan-1', targetId: 'target-1', status: 'CURRENT' } as ResearchPlanView;
  const state: ResearchPlanPanelState = {
    plan, history: [], sessionPlanId: plan.id, newPlanAvailable: false, reconCurrent: true, configurationChanged: false,
  };

  it('offers Hunt only for a fresh plan captured by the same target console', () => {
    expect(canPrepareResearchHunt('target-1', plan, state)).toBe(true);
    expect(canPrepareResearchHunt('target-2', plan, state)).toBe(false);
    expect(canPrepareResearchHunt('target-1', plan, { ...state, sessionPlanId: 'older-plan' })).toBe(false);
    expect(canPrepareResearchHunt('target-1', plan, { ...state, reconCurrent: false })).toBe(false);
    expect(canPrepareResearchHunt('target-1', plan, { ...state, configurationChanged: true })).toBe(false);
    expect(canPrepareResearchHunt('target-1', { ...plan, status: 'SUPERSEDED' }, state)).toBe(false);
  });

  it('routes planning and review to distinct configured profiles', () => {
    expect(researchTier('map')).toBe('fast');
    expect(researchTier('hunt')).toBe('fast');
    expect(researchTier('validate')).toBe('review');
    expect(researchTier('trace')).toBe('review');
  });

  it('ranks semantic neighbors by cosine similarity, independent of magnitude', () => {
    expect(semanticRank([[1, 0], [100, 100], [1, 0.01], [-1, 0], [0, 0]], 2).map(row => row.index)).toEqual([1, 0]);
    expect(() => semanticRank([[1, 0], [1]], 1)).toThrow();
    expect(() => semanticRank([[0, 0], [1, 0]], 1)).toThrow();
  });

  it('requires affirmative evidence checks for a supported review', () => {
    const input = {
      expectedRevision: 1, verdict: 'SUPPORTED', reason: 'Independent evidence trace reproduced the security effect.',
      testId: 'T-001', accessContext: 'Standard account', reproducedInFreshContext: true,
      impactDemonstrated: true, minimumPrivilegesVerified: true,
    };
    expect(researchReviewInput.safeParse(input).success).toBe(true);
    for (const key of ['reproducedInFreshContext', 'impactDemonstrated', 'minimumPrivilegesVerified']) {
      expect(researchReviewInput.safeParse({ ...input, [key]: false }).success).toBe(false);
    }
    expect(researchReviewInput.safeParse({ ...input, verdict: 'REFUTED' }).success).toBe(false);
    expect(researchReviewInput.safeParse({ expectedRevision: 1, verdict: 'REFUTED', reason: input.reason }).success).toBe(true);
  });

});
