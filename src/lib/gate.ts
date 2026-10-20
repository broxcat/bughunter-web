// The 7-Question Gate — ported verbatim from the Agentic-Bug-Hunter CLI
// (skills/triage-validation/SKILL.md). "One wrong answer = STOP. Kill it. Move on."
//
// The gate is 8 questions (Q1–Q8; Q8, the session-identity check, was added after
// the "7-Question" name stuck). They do NOT share one polarity: Q1/Q2/Q3/Q8 must be
// answered "yes" to survive, Q4/Q5/Q7 are "yes = kill", and Q6 is special — a "no"
// DOWNGRADES severity rather than killing. `evaluateGate` encodes each question's
// own polarity.
//
// Pure, side-effect-free policy: the API layer persists the answers + result; this
// module only decides. The exported shape (GATE_QUESTIONS, GateAnswers, evaluateGate)
// is unchanged from the generic version it replaces, so the UI and validate route
// need no edits.

export type GateKind = "kill" | "downgrade";

export interface GateQuestion {
  /** Stable id used as the answer key. */
  id: string;
  /** Question number in the SKILL (1–8). */
  n: number;
  /** Exact question heading from SKILL.md. */
  text: string;
  /** The answer (true = "yes") that keeps the finding alive. */
  passWhen: boolean;
  /** "kill": a wrong answer kills the finding. "downgrade": it lowers severity, not kills. */
  kind: GateKind;
  /** Verbatim guidance / kill-signal from the SKILL. */
  guidance: string;
}

/**
 * The eight questions, in the order they must be asked. Text is verbatim from
 * skills/triage-validation/SKILL.md.
 */
export const GATE_QUESTIONS: GateQuestion[] = [
  {
    id: "q1_useNow",
    n: 1,
    text: "Can an attacker use this RIGHT NOW, step by step?",
    passWhen: true,
    kind: "kill",
    guidance:
      "Fill the Setup/Request/Result/Impact/Cost template. If you CANNOT write step 2 as a real HTTP request → KILL IT.",
  },
  {
    id: "q2_acceptedImpact",
    n: 2,
    text: "Is the impact on the program's accepted impact list?",
    passWhen: true,
    kind: "kill",
    guidance:
      "Check the program's Vulnerability Types / Out of Scope. If your bug maps to a listed exclusion → KILL IT.",
  },
  {
    id: "q3_inScopeRootCause",
    n: 3,
    text: "Is the root cause in an in-scope asset?",
    passWhen: true,
    kind: "kill",
    guidance:
      "In-scope, production (not staging/dev unless in scope), not a third-party service the company merely uses. If out-of-scope → KILL IT.",
  },
  {
    id: "q4_unreachablePrivilege",
    n: 4,
    text: "Does it require privileged access that an attacker can't realistically get?",
    passWhen: false,
    kind: "kill",
    guidance:
      '"Admin can do X" = centralization risk = KILL IT. "Non-admin can do what only admin should" = valid. Physical access / MFA device / compromised victim account = usually invalid.',
  },
  {
    id: "q5_knownBehavior",
    n: 5,
    text: "Is this already known or accepted behavior?",
    passWhen: false,
    kind: "kill",
    guidance:
      "Search disclosed reports, GitHub security issues, changelog, API/design docs. If acknowledged / a design decision → KILL IT.",
  },
  {
    id: "q6_provableImpact",
    n: 6,
    text: 'Can you prove impact beyond "technically possible"?',
    passWhen: true,
    kind: "downgrade",
    guidance:
      "XSS→actual cookie/session theft; SSRF→internal endpoint returning data; SQLi→real rows exfiltrated; IDOR→another user's data in the response. If you can only show \"technically possible\" → DOWNGRADE severity, not kill.",
  },
  {
    id: "q7_knownInvalidClass",
    n: 7,
    text: "Is this a known-invalid bug class?",
    passWhen: false,
    kind: "kill",
    guidance:
      "Check the NEVER SUBMIT list. If it's on that list without a chain → KILL IT.",
  },
  {
    id: "q8_identitySurvives",
    n: 8,
    text: "Identity check — which session found this, and does it survive?",
    passWhen: true,
    kind: "kill",
    guidance:
      "Record: session id, identity, anonymous repro, cross-identity repro, stale-cred repro. IDOR/BOLA must work with session A reading B's data; priv-esc with low-priv reading high-priv; auth bypass WITHOUT a valid session. Blank answers auto-fail on auth-related findings; if you cannot answer, treat the finding as unproven.",
  },
];

export type GateAnswers = Record<string, boolean>;

export interface GateResult {
  status: "PASSED" | "KILLED";
  killedReason?: string;
  /**
   * Set when the finding passes but Q6 could not be proven: the finding is not
   * killed, but its severity should be downgraded (per the SKILL). Advisory only.
   */
  advisory?: string;
}

/**
 * Decide a finding's fate from its gate answers, honoring each question's own
 * polarity. Any "kill" question answered against its `passWhen` (or left
 * unanswered) kills the finding; Q6 ("downgrade") answered against its `passWhen`
 * does not kill but attaches a severity-downgrade advisory.
 *
 * A missing answer is treated as not satisfying the question — the SKILL is
 * explicit that blanks auto-fail (notably for the Q8 identity check).
 */
export function evaluateGate(answers: GateAnswers): GateResult {
  const satisfied = (q: GateQuestion): boolean => answers[q.id] === q.passWhen;

  const killedBy = GATE_QUESTIONS.filter(
    (q) => q.kind === "kill" && !satisfied(q),
  );

  if (killedBy.length > 0) {
    const killedReason =
      "Failed the 7-Question Gate on: " +
      killedBy.map((q) => `Q${q.n} (${q.text})`).join(" | ");
    return { status: "KILLED", killedReason };
  }

  const downgrade = GATE_QUESTIONS.find(
    (q) => q.kind === "downgrade" && !satisfied(q),
  );
  if (downgrade) {
    return {
      status: "PASSED",
      advisory: `Q${downgrade.n}: impact not proven beyond "technically possible" — downgrade severity.`,
    };
  }

  return { status: "PASSED" };
}
