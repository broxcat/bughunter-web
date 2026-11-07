import { z } from 'zod';

export const researchProvider = z.enum(['codex', 'claude']);
export type ResearchProvider = z.infer<typeof researchProvider>;
export const launchProfile = z.enum(['standard', 'yolo', 'plan']);
export type LaunchProfile = z.infer<typeof launchProfile>;
export const providerSelection = z.strictObject({ provider: researchProvider, profile: launchProfile.optional() }).refine(
  value => value.profile === undefined || (value.provider === 'codex' ? value.profile !== 'plan' : value.profile !== 'yolo'), 'Unsupported profile');
export const providerName = (provider: ResearchProvider) => provider === 'claude' ? 'Claude Code' : 'Codex CLI';
export function providerTmuxIdentity(targetId: string, provider: ResearchProvider = 'codex') {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(targetId)) throw new Error('Invalid target');
  researchProvider.parse(provider);
  return provider === 'codex' ? `bughunter-${targetId}` : `bughunter_claude_${targetId}`;
}

export const engineStatusSchema = z.object({
  provider: researchProvider,
  installation: z.enum(['available', 'missing', 'error']),
  authentication: z.enum(['authenticated', 'required', 'unknown']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).nullable(),
  code: z.enum(['CLI_MISSING', 'CLI_CHECK_FAILED', 'AUTH_REQUIRED', 'AUTH_CHECK_FAILED']).nullable(),
}).strict();
export const engineStatusesSchema = z.array(engineStatusSchema).length(2).refine(rows => new Set(rows.map(row => row.provider)).size === 2);
export const launcherStatusSchema = z.array(engineStatusSchema.extend({
  profiles: z.array(launchProfile).max(2),
  runningProfile: launchProfile.nullable(),
}).strict().refine(row => [...row.profiles,...(row.runningProfile?[row.runningProfile]:[])].every(profile=>row.provider==='codex'?profile!=='plan':profile!=='yolo'))).length(2).refine(rows => new Set(rows.map(row => row.provider)).size === 2);
export type ResearchEngineStatus = z.infer<typeof engineStatusSchema>;
