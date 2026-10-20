// The 7-Question Gate — the triage discipline that keeps weak/theoretical
// findings out of reports. Every question is phrased so that "yes" is the
// answer that keeps the finding alive; a single "no" kills it.
//
// Pure, side-effect-free policy: the API layer persists the answers and the
// result, this module only decides.

export interface GateQuestion {
  id: string;
  text: string;
}

/**
 * The seven questions, in the order they should be asked. Each must be
 * answered "yes" (true) for a finding to pass the gate.
 */
export const GATE_QUESTIONS: GateQuestion[] = [
  {
    id: "inScope",
    text: "Is the affected asset explicitly in scope for this program?",
  },
  {
    id: "realImpact",
    text: "Is there concrete security impact, not just a best-practice or theoretical issue?",
  },
  {
    id: "exploitableNow",
    text: "Can an attacker exploit this right now, without unrealistic preconditions (no MITM, no victim self-XSS)?",
  },
  {
    id: "affectsOthers",
    text: "Does the attack affect other users or the organization, not only the attacker's own account?",
  },
  {
    id: "reproducible",
    text: "Can you reproduce it reliably from a clean session?",
  },
  {
    id: "hasEvidence",
    text: "Do you have concrete evidence or a working proof-of-concept?",
  },
  {
    id: "notDuplicate",
    text: "Is this not a known issue, duplicate, or already-reported bug?",
  },
];

export type GateAnswers = Record<string, boolean>;

export interface GateResult {
  status: "PASSED" | "KILLED";
  killedReason?: string;
}

/**
 * Decide a finding's fate from its gate answers. All seven questions must be
 * answered `true` to pass; any question that is missing or answered `false`
 * kills the finding, and the reason names every failing question.
 */
export function evaluateGate(answers: GateAnswers): GateResult {
  const failed = GATE_QUESTIONS.filter((q) => answers[q.id] !== true);

  if (failed.length === 0) {
    return { status: "PASSED" };
  }

  const killedReason =
    "Failed the 7-Question Gate on: " +
    failed.map((q) => q.text).join(" | ");

  return { status: "KILLED", killedReason };
}
