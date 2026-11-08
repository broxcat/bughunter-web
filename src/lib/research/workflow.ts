import type { ResearchPlanPanelState, ResearchPlanView } from '../researchPlanView';

export function canPrepareResearchHunt(
  targetId: string,
  selected: ResearchPlanView | null,
  state: ResearchPlanPanelState | null,
): boolean {
  return Boolean(selected && state?.reconCurrent && !state.configurationChanged &&
    selected.targetId === targetId && selected.status === 'CURRENT' && selected.id === state.sessionPlanId);
}

export type ResearchStage =
  | { stage: 'map' }
  | { stage: 'hunt'; planId: string; objectiveId: string }
  | { stage: 'validate' | 'trace'; sessionId: string; hypothesisId: string; revision: number };

export type HarnessSource = {
  id: string;
  label: string;
  reference: string;
  text: string;
};

export type HarnessResult = {
  assessment: 'PLANNED' | 'SUPPORTED' | 'REFUTED' | 'INCONCLUSIVE';
  summary: string;
  nextStep: string;
  citations: Array<Pick<HarnessSource, 'id' | 'label' | 'reference'>>;
  memoryUsed: number;
};

export type HarnessRunView = {
  id: string;
  status: string;
  provider: string;
  model: string;
  result: HarnessResult | null;
};

export const researchTier = (stage: ResearchStage['stage']) => stage === 'map' || stage === 'hunt' ? 'fast' : 'review';

export const stageAssessments = (stage: ResearchStage['stage']): HarnessResult['assessment'][] =>
  researchTier(stage) === 'fast' ? ['PLANNED'] : ['SUPPORTED', 'REFUTED', 'INCONCLUSIVE'];
