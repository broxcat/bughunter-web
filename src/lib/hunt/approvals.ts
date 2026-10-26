/** Only these fixed, bounded delay proofs can ever be explicitly approved. */
export const APPROVABLE_HUNT_TECHNIQUES = ["sqli.timing-screen", "sqli.timing-confirm", "cmdi.timing-screen", "cmdi.timing-confirm"] as const;
export function isHuntTechniqueApproved(id: string, approvals: readonly string[]): boolean {
  return APPROVABLE_HUNT_TECHNIQUES.some(allowed => allowed === id) && approvals.includes(id);
}
