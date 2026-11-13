export type ResearchStage =
  | { stage: 'map' }
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

export const researchTier = (stage: ResearchStage['stage']) => stage === 'map' ? 'fast' : 'review';

export const stageAssessments = (stage: ResearchStage['stage']): HarnessResult['assessment'][] =>
  researchTier(stage) === 'fast' ? ['PLANNED'] : ['SUPPORTED', 'REFUTED', 'INCONCLUSIVE'];
