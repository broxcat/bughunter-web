import { describe, expect, it } from "vitest";
import { HUNT_TECHNIQUES } from "@/lib/hunt/catalogData";
import { executeHuntTechnique } from "@/server/hunt/techniques";
import type { TechniqueContext } from "@/server/hunt/runtime";
import { analyzeCorpus } from "@/server/hunt/corpus";
import { selectHuntTechniques } from "@/lib/hunt/catalog";
import { EMPTY_READINESS_FACTS, resolveHuntReadiness } from "@/lib/hunt/readiness";
const base = "https://timing.example.test";
function context(jitter = false): TechniqueContext {
  let requests = 0;
  return { ctx: { scanRunId: "r", targetId: "t", userId: "u", host: "timing.example.test", baseUrl: base }, corpus: analyzeCorpus({ html: "", urls: [`${base}/search?q=1`, `${base}/probe?host=example.test`], authenticated: false }, base), credentials: [], cache: new Map(), approvedTechniques: [], remainingMs: () => 20000,
    request: async (url: string) => { requests++; const delay = /(?:sleep\s+|pg_sleep\()([012])/.exec([...new URL(url).searchParams.values()].join(" ")); return { url, method: "GET", status: 200, ms: jitter ? requests % 2 ? 2500 : 100 : 100 + Number(delay?.[1] ?? 0) * 1000, body: '{"id":1,"name":"stable record"}', bodyLen: 32, headers: { "content-type": "application/json" } }; } };
}
describe("explicit bounded timing approval", () => {
  it("requires per-run approval even for a supported timing method", async () => {
    const c = context();
    const t = HUNT_TECHNIQUES.find(t => t.id === "sqli.timing-screen")!;
    await expect(executeHuntTechnique(t, c)).rejects.toThrow("UNSUPPORTED_TECHNIQUE");
    const plan = selectHuntTechniques(resolveHuntReadiness({ qualifying: ["SQL_INJECTION"], nonQualifying: [] }, EMPTY_READINESS_FACTS), c.corpus.surface, EMPTY_READINESS_FACTS);
    expect(plan.find(p => p.technique.id === t.id)?.reason).toBe("REQUIRE_APPROVAL");
  });
  for (const prefix of ["sqli", "cmdi"]) {
    it(`${prefix} needs matched screening and independent confirmation; jitter never promotes`, async () => {
      const screen = HUNT_TECHNIQUES.find(t => t.id === `${prefix}.timing-screen`)!;
      const confirm = HUNT_TECHNIQUES.find(t => t.id === `${prefix}.timing-confirm`)!;
      const c = context(); c.approvedTechniques = [screen.id, confirm.id];
      expect(await executeHuntTechnique(confirm, c)).toEqual([]);
      expect((await executeHuntTechnique(screen, c))[0].evidenceLevel).toBe("CANDIDATE");
      expect((await executeHuntTechnique(confirm, c))[0].evidenceLevel).toBe("CONFIRMED");
      const noisy = context(true); noisy.approvedTechniques = c.approvedTechniques;
      await executeHuntTechnique(screen, noisy);
      expect(await executeHuntTechnique(confirm, noisy)).toEqual([]);
    });
  }
});
