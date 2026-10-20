import { describe, it, expect } from "vitest";
import { GATE_QUESTIONS, evaluateGate, type GateAnswers } from "@/lib/gate";

// Build the set of answers that keeps EVERY question alive: each question's
// `passWhen` value. Spreading this and overriding one key lets each test flip a
// single question's polarity in isolation.
function allPassing(): GateAnswers {
  return Object.fromEntries(GATE_QUESTIONS.map((q) => [q.id, q.passWhen]));
}

const byN = (n: number) => {
  const q = GATE_QUESTIONS.find((x) => x.n === n);
  if (!q) throw new Error(`no gate question Q${n}`);
  return q;
};

describe("GATE_QUESTIONS shape", () => {
  it("has the 8 questions with the documented polarities", () => {
    expect(GATE_QUESTIONS).toHaveLength(8);
    // Q1/Q2/Q3/Q8 survive on "yes" and kill otherwise.
    for (const n of [1, 2, 3, 8]) {
      expect(byN(n).passWhen).toBe(true);
      expect(byN(n).kind).toBe("kill");
    }
    // Q4/Q5/Q7 are "yes = kill" (passWhen false).
    for (const n of [4, 5, 7]) {
      expect(byN(n).passWhen).toBe(false);
      expect(byN(n).kind).toBe("kill");
    }
    // Q6 downgrades rather than kills.
    expect(byN(6).passWhen).toBe(true);
    expect(byN(6).kind).toBe("downgrade");
  });
});

describe("evaluateGate — happy path", () => {
  it("PASSES when every question is answered correctly, with no advisory", () => {
    const result = evaluateGate(allPassing());
    expect(result.status).toBe("PASSED");
    expect(result.advisory).toBeUndefined();
    expect(result.killedReason).toBeUndefined();
  });
});

describe("evaluateGate — kill questions answered against their polarity", () => {
  // Q1/Q2/Q3/Q8 are passWhen:true -> answering NO (false) must KILL.
  it.each([1, 2, 3, 8])("Q%i answered NO kills the finding", (n) => {
    const q = byN(n);
    const answers = { ...allPassing(), [q.id]: false };
    const result = evaluateGate(answers);
    expect(result.status).toBe("KILLED");
    expect(result.killedReason).toContain(`Q${n}`);
  });

  // Q4/Q5/Q7 are passWhen:false -> answering YES (true) must KILL.
  it.each([4, 5, 7])("Q%i answered YES kills the finding", (n) => {
    const q = byN(n);
    const answers = { ...allPassing(), [q.id]: true };
    const result = evaluateGate(answers);
    expect(result.status).toBe("KILLED");
    expect(result.killedReason).toContain(`Q${n}`);
  });
});

describe("evaluateGate — Q6 downgrade semantics", () => {
  it("Q6 answered NO still PASSES but sets an advisory (not killed)", () => {
    const q6 = byN(6);
    const answers = { ...allPassing(), [q6.id]: false };
    const result = evaluateGate(answers);
    expect(result.status).toBe("PASSED");
    expect(result.killedReason).toBeUndefined();
    expect(result.advisory).toBeDefined();
    expect(result.advisory).toContain("Q6");
    expect(result.advisory).toContain("downgrade");
  });

  it("a kill failure outranks the Q6 downgrade (KILLED, no advisory)", () => {
    const answers = { ...allPassing(), [byN(6).id]: false, [byN(1).id]: false };
    const result = evaluateGate(answers);
    expect(result.status).toBe("KILLED");
    expect(result.advisory).toBeUndefined();
  });
});

describe("evaluateGate — missing answers", () => {
  it("a missing answer on a kill question KILLS (blanks auto-fail)", () => {
    const answers = { ...allPassing() };
    delete answers[byN(8).id]; // drop the Q8 identity answer
    const result = evaluateGate(answers);
    expect(result.status).toBe("KILLED");
    expect(result.killedReason).toContain("Q8");
  });

  it("a missing answer on Q6 PASSES with the downgrade advisory, not a kill", () => {
    const answers = { ...allPassing() };
    delete answers[byN(6).id];
    const result = evaluateGate(answers);
    expect(result.status).toBe("PASSED");
    expect(result.advisory).toContain("Q6");
  });

  it("an empty answer object KILLS and names every kill question", () => {
    const result = evaluateGate({});
    expect(result.status).toBe("KILLED");
    for (const n of [1, 2, 3, 8]) {
      // Q1/Q2/Q3/Q8 need "yes" and a blank fails them.
      expect(result.killedReason).toContain(`Q${n}`);
    }
    // Q4/Q5/Q7 need "no"; a blank (undefined) also fails passWhen:false,
    // so they are listed too.
    for (const n of [4, 5, 7]) {
      expect(result.killedReason).toContain(`Q${n}`);
    }
  });
});
