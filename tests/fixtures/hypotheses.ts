import type { WorkspaceHypothesis } from "@/lib/research/hypotheses";
export const hypothesisFixture = (overrides: Partial<WorkspaceHypothesis> = {}): WorkspaceHypothesis => ({
  externalId: "H-001", title: "Observed object boundary", status: "OPEN",
  hypothesis: "The observed object response may cross an account boundary.",
  evidenceFor: [{ ref: "evidence/observation.txt#request-1", summary: "Captured a read-only object request on the local fixture." }],
  evidenceAgainst: [], nextTest: "Compare the same observed request with a second authorized test account.",
  expectedSignal: "Both test accounts receive the same owned fixture object.",
  falsificationCondition: "Access is denied or returns only the requesting account's fixture object.",
  tags: ["object-access"], ...overrides,
});
export const hypothesesFixture = (sessionId = "session", hypotheses = [hypothesisFixture()]) => ({ version: 1, sessionId, hypotheses });
