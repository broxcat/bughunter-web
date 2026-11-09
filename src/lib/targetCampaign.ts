import { MISSING_HUNTER_UA, POLICY_REVIEW_ANCHOR } from './programExecutionPolicy';

export const campaignStages = ['Target', 'Recon', 'Research', 'Findings'] as const;
type Stage = (typeof campaignStages)[number];
export type StageState = 'not started' | 'running' | 'done' | 'blocked';
type StageView = { stage: Stage; state: StageState; detail?: string; fix?: string };
export type CampaignAction = { label: string; href: string } | { label: string; startRecon: true };
export type CampaignFacts = {
  programId: string;
  runId: string | null;
  runStatus: string | null;
  runOutcome: string | null;
  hasHandoff: boolean;
  handoffPending: boolean;
  scopeCurrent: boolean;
  reconTotal: number;
  reconFinished: number;
  standaloneTotal: number;
  researchCreating: number;
  researchReady: number;
  researchFailed: number;
  findings: number;
  reviewedFindings: number;
};

export function campaignActivity(facts: CampaignFacts) {
  const recon = facts.runStatus === 'QUEUED' || facts.runStatus === 'RUNNING' || facts.handoffPending || facts.standaloneTotal > 0;
  return {
    active: recon || facts.researchCreating > 0,
    key: JSON.stringify([facts.runId, facts.runStatus, facts.reconTotal, facts.reconFinished, facts.standaloneTotal,
      facts.handoffPending, facts.hasHandoff, facts.researchCreating, facts.researchReady]),
  };
}

export function targetCampaign(program: { id: string; deletingAt: Date | null; assetCount: number; policyBlocker: string | null }, facts: CampaignFacts) {
  const root = '/targets/' + program.id;
  const settings = root + '/settings#' + POLICY_REVIEW_ANCHOR;
  const history = '/recon?program=' + program.id;
  const researchUrl = '/research?program=' + program.id;
  const busyRecon = facts.runStatus === 'QUEUED' || facts.runStatus === 'RUNNING' || facts.standaloneTotal > 0 || facts.handoffPending;
  const deletion = program.deletingAt ? 'Target deletion is in progress. Retry Delete target to finish cleanup.' : null;
  const blocker = deletion ?? program.policyBlocker;
  const scopeMissing = !program.assetCount;
  const target: StageView = blocker || scopeMissing
    ? { stage: 'Target', state: 'blocked', detail: blocker ?? 'Add at least one active Scope Asset before Recon.',
      fix: blocker === MISSING_HUNTER_UA ? '/settings#hunter-identity' : deletion ? root + '/settings' : settings }
    : { stage: 'Target', state: 'done', detail: program.assetCount + (program.assetCount === 1 ? ' asset in scope' : ' assets in scope') };

  let recon: StageView = { stage: 'Recon', state: 'not started' };
  if (busyRecon) {
    const detail = facts.handoffPending ? 'Preparing the Research handoff.'
      : facts.standaloneTotal > 0 && facts.runStatus !== 'QUEUED' && facts.runStatus !== 'RUNNING'
        ? facts.standaloneTotal + (facts.standaloneTotal === 1 ? ' asset run active' : ' asset runs active')
        : facts.reconFinished + '/' + facts.reconTotal + ' assets finished';
    recon = { stage: 'Recon', state: 'running', detail };
  } else if (facts.runId && facts.scopeCurrent) {
    if (facts.runStatus === 'COMPLETED' && ['SUCCESS', 'PARTIAL'].includes(facts.runOutcome ?? '') && facts.hasHandoff) {
      recon = { stage: 'Recon', state: 'done', ...(facts.runOutcome === 'PARTIAL' ? { detail: 'Partial coverage. See History for the limits.' } : {}) };
    } else {
      const detail = facts.runStatus === 'CANCELLED' ? 'The last Recon run was cancelled.'
        : facts.runStatus === 'FAILED' || facts.runOutcome === 'FAILED' ? 'The last Recon run failed without usable results.'
        : facts.runOutcome === 'UNSUPPORTED' ? 'The last Recon run used an unsupported technique.'
        : !facts.hasHandoff ? 'The last Recon run did not produce a Research handoff.'
        : 'The last Recon run has no recorded outcome.';
      recon = { stage: 'Recon', state: 'blocked', detail, fix: history };
    }
  } else if (facts.runId) recon.detail = 'Scope changed since the last run.';

  let research: StageView = { stage: 'Research', state: 'not started' };
  if (facts.researchCreating) research = { stage: 'Research', state: 'running', detail: 'Preparing ' + facts.researchCreating + (facts.researchCreating === 1 ? ' workspace' : ' workspaces') };
  else if (facts.researchReady) research = facts.findings
    ? { stage: 'Research', state: 'done', detail: 'Findings available for review.' }
    : { stage: 'Research', state: 'running', detail: facts.researchReady + (facts.researchReady === 1 ? ' workspace available' : ' workspaces available') };
  else if (facts.researchFailed) research = { stage: 'Research', state: 'blocked', detail: 'Research workspace provisioning failed.', fix: researchUrl + '&view=details' };
  const findings: StageView = facts.findings
    ? { stage: 'Findings', state: facts.reviewedFindings === facts.findings ? 'done' : 'running',
      detail: facts.reviewedFindings + '/' + facts.findings + ' reviewed' }
    : { stage: 'Findings', state: 'not started' };
  const stages = [target, recon, research, findings];

  let current: StageView;
  let action: CampaignAction;
  let next: string;
  if (target.state === 'blocked') {
    current = target;
    action = { label: deletion ? 'Open target settings' : blocker ? 'Fix policy' : 'Add scope', href: target.fix! };
    next = deletion ? 'Finish Target cleanup.' : blocker ? 'Resolve the execution policy before starting Recon.' : 'Add an authorized asset to start Recon.';
  } else if (busyRecon) {
    current = recon;
    action = { label: 'View progress', href: '#recon' };
    next = 'Wait for Recon to finish before opening Research.';
  } else if (facts.findings) {
    current = findings;
    action = { label: 'View findings', href: root + '/findings' };
    next = findings.state === 'done' ? 'Open a finding to review its evidence or prepare a report.' : 'Review the findings and their evidence.';
  } else if (recon.state !== 'done') {
    current = recon;
    action = { label: recon.state === 'blocked' ? 'Retry recon' : 'Start recon', startRecon: true };
    next = recon.state === 'blocked' ? 'Review the previous run, then retry Recon.' : 'Run Recon on the current scope.';
  } else {
    current = research;
    action = { label: 'Open research', href: research.fix ?? researchUrl };
    next = research.state === 'blocked' ? 'Resolve the workspace issue in Research details.' : 'Continue with the Recon results in Research.';
  }
  return { stages, current, action, next, activity: campaignActivity(facts) };
}
