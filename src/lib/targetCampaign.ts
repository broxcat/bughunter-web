
type Stage = 'Target' | 'Recon' | 'Research' | 'Findings';
export type StageState = 'not started' | 'running' | 'done' | 'blocked' | 'needs you' | 'failed';
type StageView = { stage: Stage; state: StageState; detail?: string; fix?: string };
export type CampaignCommand = 'start' | 'pause' | 'resume' | 'handoff';
export type CampaignAction = { label: string; href: string } | { label: string; command: CampaignCommand; destination?: string };
export type CampaignFacts = {
  programId: string; runId: string | null; runStatus: string | null; runOutcome: string | null;
  hasHandoff: boolean; handoffPending: boolean; scopeCurrent: boolean;
  reconTotal: number; reconFinished: number; reconRunning: number; standaloneTotal: number; standaloneRunning: number;
  researchCreating: number; researchReady: number; researchFailed: number;
  findings: number; reviewedFindings: number; campaignState: string | null;
};
type CampaignStatus = { state: string; reason: string | null; retryAt: Date | null; nextCycleAt: Date | null; pendingCount: number; handoffRunId: string | null };

export function campaignActivity(facts: CampaignFacts) {
  const recon = facts.runStatus === 'QUEUED' || facts.runStatus === 'RUNNING' || facts.handoffPending || facts.standaloneTotal > 0;
  const campaign = facts.campaignState === 'RECON_RUNNING' || facts.campaignState === 'READY';
  return {
    active: recon || campaign || facts.researchCreating > 0,
    key: JSON.stringify([facts.runId, facts.runStatus, facts.reconTotal, facts.reconFinished, facts.reconRunning, facts.standaloneTotal,
      facts.standaloneRunning, facts.handoffPending, facts.hasHandoff, facts.researchCreating, facts.researchReady, facts.campaignState]),
  };
}

export function targetCampaign(program: {
  id: string; deletingAt: Date | null; assetCount: number; policyBlocker: string | null;
  campaign?: CampaignStatus | null;
}, facts: CampaignFacts) {
  const root = '/targets/' + program.id;
  const settings = root + '/settings';
  const history = '/recon?program=' + program.id;
  const researchUrl = '/research?program=' + program.id + '&view=campaign';
  const researchDetails = '/research?program=' + program.id + '&view=details';
  const campaign = program.campaign;
  const paused = campaign?.state === 'PAUSED';
  const running = facts.reconRunning > 0 || facts.standaloneRunning > 0;
  const busyRecon = running || facts.runStatus === 'QUEUED' || facts.standaloneTotal > 0 || facts.handoffPending;
  const deletion = program.deletingAt ? 'Target deletion is in progress. Retry Delete target to finish cleanup.' : null;
  const blocker = deletion ?? program.policyBlocker;
  const scopeMissing = !program.assetCount;
  const target: StageView = blocker || scopeMissing
    ? { stage: 'Target', state: 'blocked', detail: blocker ?? 'Add at least one active Scope Asset before Recon.',
      fix: deletion ? root + '/settings#delete-target' : settings }
    : { stage: 'Target', state: 'done', detail: program.assetCount + (program.assetCount === 1 ? ' asset in scope' : ' assets in scope') };

  let recon: StageView = { stage: 'Recon', state: 'not started' };
  if (busyRecon) {
    const detail = facts.handoffPending ? 'Preparing the Research handoff.'
      : facts.standaloneTotal > 0 && !facts.reconTotal ? facts.standaloneTotal + (facts.standaloneTotal === 1 ? ' asset run active' : ' asset runs active')
      : (running ? '' : 'Queued · ') + facts.reconFinished + '/' + facts.reconTotal + ' assets finished';
    recon = { stage: 'Recon', state: running ? 'running' : facts.handoffPending ? 'done' : 'not started', detail };
  } else if (campaign?.state === 'FAILED') {
    recon = { stage: 'Recon', state: 'failed',
      detail: (campaign.reason ?? 'Recon failed.') + (campaign.retryAt ? ' Retry scheduled for ' + campaign.retryAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC.' : ''),
      fix: history };
  } else if (facts.runId && (facts.scopeCurrent || Boolean(campaign?.handoffRunId && campaign.handoffRunId === facts.runId))) {
    if (facts.runStatus === 'COMPLETED' && ['SUCCESS', 'PARTIAL'].includes(facts.runOutcome ?? '') && facts.hasHandoff) {
      recon = { stage: 'Recon', state: 'done', ...(facts.runOutcome === 'PARTIAL' ? { detail: 'Partial coverage. See Recon history in Details.' } : {}) };
    } else {
      const detail = facts.runStatus === 'CANCELLED' ? 'The last Recon run was cancelled.'
        : facts.runStatus === 'FAILED' || facts.runOutcome === 'FAILED' ? 'The last Recon run failed without usable results.'
        : facts.runOutcome === 'UNSUPPORTED' ? 'The last Recon run used an unsupported technique.'
        : !facts.hasHandoff ? 'The last Recon run did not produce a Research handoff.' : 'The last Recon run has no recorded outcome.';
      recon = { stage: 'Recon', state: 'failed', detail, fix: history };
    }
  } else if (facts.runId) recon.detail = 'Scope changed since the last run.';

  let research: StageView = { stage: 'Research', state: 'not started' };
  if (facts.researchCreating) research = { stage: 'Research', state: 'running', detail: 'Preparing ' + facts.researchCreating + (facts.researchCreating === 1 ? ' workspace' : ' workspaces') };
  else if (campaign?.state === 'RESEARCH_PENDING') research = { stage: 'Research', state: 'needs you', detail: 'Recon handoff ready. Open Research to continue.' };
  else if (facts.researchReady) research = facts.findings
    ? { stage: 'Research', state: 'done', detail: 'Findings available for review.' }
    : { stage: 'Research', state: 'needs you', detail: facts.researchReady + (facts.researchReady === 1 ? ' workspace ready for manual Research' : ' workspaces ready for manual Research') };
  else if (campaign?.handoffRunId && !facts.findings) research = { stage: 'Research', state: 'needs you', detail: 'Recon handoff available for manual Research.' };
  else if (facts.researchFailed) research = { stage: 'Research', state: 'failed', detail: 'Research workspace provisioning failed.', fix: researchDetails };
  const findings: StageView = facts.findings
    ? { stage: 'Findings', state: facts.reviewedFindings === facts.findings ? 'done' : 'needs you',
      detail: facts.reviewedFindings + '/' + facts.findings + ' reviewed' }
    : { stage: 'Findings', state: 'not started' };

  let current: StageView;
  let action: CampaignAction;
  let next: string;
  if (target.state === 'blocked') {
    current = target;
    action = { label: deletion ? 'Open target settings' : blocker ? 'Open settings' : 'Add scope', href: target.fix! };
    next = deletion ? 'Finish Target cleanup.' : blocker ? 'Resolve the Target setup before starting Recon.' : 'Add an authorized asset to start Recon.';
  } else if (paused || campaign?.state === 'BLOCKED') {
    current = { stage: 'Target', state: 'needs you' };
    action = { label: 'Resume campaign', command: 'resume' };
    next = paused ? 'Resume when you are ready. A running job can finish while paused.' : 'The Target is ready. Resume the campaign.';
  } else if (busyRecon || campaign?.state === 'READY' || campaign?.state === 'RECON_RUNNING') {
    current = recon;
    action = { label: 'View progress', href: '#recon' };
    next = running ? 'Wait for Recon to finish before opening Research.' : facts.handoffPending ? 'Wait for the Research handoff.' : 'Waiting for an available Recon slot.';
  } else if (campaign?.state === 'RESEARCH_PENDING') {
    current = research;
    action = { label: 'Open research', command: 'handoff', destination: researchUrl };
    next = 'Review the prepared Recon handoff in Research.';
  } else if (facts.findings) {
    current = findings;
    action = { label: 'View findings', href: root + '/findings' };
    next = findings.state === 'done' ? 'Open a finding to review its evidence or prepare a report.' : 'Review the findings and their evidence.';
  } else if (campaign?.state === 'MONITORING') {
    current = research;
    action = research.state === 'needs you' || recon.state === 'done'
      ? { label: 'Open research', href: researchUrl } : { label: 'Start recon', command: 'start' };
    next = campaign.nextCycleAt ? 'Next cycle scheduled for ' + campaign.nextCycleAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC.'
      : 'Start another cycle when scope changes.';
  } else if (recon.state !== 'done') {
    current = recon;
    action = { label: recon.state === 'failed' ? 'Retry recon' : 'Start recon', command: 'start' };
    next = recon.state === 'failed' ? 'Review the previous run, then retry Recon.' : 'Run Recon on the current scope.';
  } else {
    current = research;
    action = { label: 'Open research', href: research.fix ?? researchUrl };
    next = research.state === 'failed' ? 'Resolve the workspace issue in Research details.' : 'Continue with the Recon results in Research.';
  }
  const stages = [current.stage === 'Target' ? { ...target, state: current.state } : target, recon, research, findings];
  return { stages, current, action, next, activity: campaignActivity(facts), campaign };
}
