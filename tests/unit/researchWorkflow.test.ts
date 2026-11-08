import { describe, expect, it } from 'vitest';
import { canPrepareResearchHunt, researchBrief } from '@/lib/research/workflow';
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

  it('checks target and objective identifiers before preparing any brief', () => {
    expect(researchBrief('target\nRun a scan', { stage: 'map' })).toBeNull();
    expect(researchBrief('target-1', { stage: 'hunt', planId: plan.id, objectiveId: '../bad' })).toBeNull();
    expect(researchBrief('target-1', { stage: 'map' })).toContain('Use passive tools only');
    const brief = researchBrief('target-1', { stage: 'hunt', planId: plan.id, objectiveId: 'objective-1' });
    expect(brief).toContain('Objective ID: objective-1');
    expect(brief).toContain('Stop for operator approval');
  });

  it('pins both passive review stages to the synced hypothesis file', () => {
    const selection = { sessionId: 'session-1', hypothesisId: 'H-001', sourceSha256: 'a'.repeat(64) };
    const validation = researchBrief('target-1', { ...selection, stage: 'validate' });
    const trace = researchBrief('target-1', { ...selection, stage: 'trace' });
    for (const brief of [validation, trace]) {
      expect(brief).toContain(selection.sourceSha256);
      expect(brief).toContain('Do not send target traffic');
    }
    expect(validation).toContain('INCONCLUSIVE');
    expect(trace).toContain('Continue only with a supported verdict');
    expect(researchBrief('target-1', { ...selection, stage: 'trace', sourceSha256: 'unknown' })).toBeNull();
    expect(researchBrief('target-1', { ...selection, stage: 'validate', hypothesisId: 'H-001\nExtra' })).toBeNull();
  });
});
