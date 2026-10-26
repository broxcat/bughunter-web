import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { withTargetExecution } from "@/server/execution";
import { HuntBudget } from "@/server/hunt/budget";
import { probe } from "@/server/scanners/http";
import { enforcedToolArgs } from "@/server/scanners/toolPolicy";
import { operatorOobBase } from "@/server/hunt/oobPolicy";
let server: Server; let base: string; const received: string[] = [];
beforeAll(async () => { server = createServer((req, res) => { received.push(req.headers["user-agent"] ?? ""); if (req.url === "/redirect") { res.writeHead(302, { location: "http://foreign.invalid/" }); res.end(); } else res.end("x".repeat(100000)); }); server.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
describe("runtime confinement on real local HTTP", () => {
  it("rechecks scope before every request, stops after removal, and overrides scanner UA", async () => {
    let active = true; const start = received.length;
    const budget = new HuntBudget(async () => { if (!active) throw new Error("removed"); });
    try {
      await withTargetExecution({ targetId: "owned", host: new URL(base).host, requiredUserAgent: "Program-Required/7", qualifying: [], nonQualifying: [] }, () => budget.run(async () => {
        const first = await probe(base, { headers: { "User-Agent": "wrong" } });
        expect(first.status).toBe(200); expect(first.body.length).toBeLessThanOrEqual(65536);
        active = false;
        expect((await probe(base)).error).toBe("SCOPE_REVOKED");
        expect((await probe(base)).status).toBe(0);
      }));
      expect(received.slice(start)).toEqual(["Program-Required/7"]); expect(budget.requests).toBe(1);
    } finally { budget.close(); }
  });
  it("rejects foreign hosts, observes redirects without following, and blocks CLI bypass", async () => {
    const budget = new HuntBudget();
    try { await withTargetExecution({ targetId: "owned", host: new URL(base).host, requiredUserAgent: "Program/7", qualifying: [], nonQualifying: [] }, () => budget.run(async () => {
      expect((await probe("http://foreign.invalid/")).status).toBe(0);
      expect((await probe(`${base}/redirect`)).status).toBe(302);
      for (const tool of ["nuclei", "dalfox", "katana", "httpx", "sh"]) expect(() => enforcedToolArgs(tool, [base])).toThrow("cannot be enforced");
      expect(budget.requests).toBe(1);
    })); } finally { budget.close(); }
  });
  it("requires an explicit OOB operator destination and rejects metadata/credential URLs", () => {
    const previous = process.env.OOB_PUBLIC_BASE_URL;
    try {
      for (const value of ["", "http://169.254.169.254/", "http://metadata.google.internal/", "http://user:secret@callback.test/", "file:///tmp/a", "http://callback.test/?token=secret"]) { process.env.OOB_PUBLIC_BASE_URL = value; expect(operatorOobBase()).toBeNull(); }
      process.env.OOB_PUBLIC_BASE_URL = "https://operator-callback.test/"; expect(operatorOobBase()?.host).toBe("operator-callback.test");
    } finally { if (previous === undefined) delete process.env.OOB_PUBLIC_BASE_URL; else process.env.OOB_PUBLIC_BASE_URL = previous; }
  });
});
