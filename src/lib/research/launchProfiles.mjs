// Server-owned launch choices. No browser paths, commands, endpoints or config.
export const launchProfiles = Object.freeze({
  codex: Object.freeze(['standard', 'yolo']),
  claude: Object.freeze(['standard', 'plan']),
});
export function legacyProfile(provider) { return provider === 'codex' ? 'yolo' : 'standard'; }
export function assertLaunchProfile(provider, profile) {
  if (!Object.hasOwn(launchProfiles, provider) || !launchProfiles[provider].includes(profile)) throw new Error('INVALID_PROFILE');
  return profile;
}
export function codexProfileArguments(profile) {
  assertLaunchProfile('codex', profile);
  return profile === 'yolo' ? ['--yolo'] : ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write'];
}
export function claudePermissionMode(profile) {
  assertLaunchProfile('claude', profile);
  return profile === 'plan' ? 'plan' : 'manual';
}
export const profileDescription = (provider, profile) => provider === 'codex'
  ? profile === 'yolo' ? 'YOLO bypasses native Codex approval and sandbox prompts. BugHunter Scope authorization and methodology confirmation gates still apply.' : 'Standard uses native on-request approvals and the workspace-write sandbox. BugHunter Scope controls still apply.'
  : profile === 'plan' ? 'Plan uses native planning permissions. Passive tools and scoped Burp observations only.' : 'Standard uses native manual permissions. Passive tools and scoped Burp observations only.';
