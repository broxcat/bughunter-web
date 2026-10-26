import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { withTargetExecution, executionHeaders, assertExecutionUrl, scanRejection } from "@/server/execution";
import { probe } from "@/server/scanners/http";
import { enforcedToolArgs, safeCommandSummary } from "@/server/scanners/toolPolicy";

let server: Server;
let base: string;
const seen: (string | undefined)[] = [];
beforeAll(async () => {
  server = createServer((req, res) => { seen.push(req.headers["user-agent"]); if (req.url === "/redirect") { res.writeHead(302, { Location: "http://foreign.example/" }); } res.end("ok"); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));
function context() { return { targetId: "test", host: new URL(base).host, requiredUserAgent: "Program-Required/2.1", qualifying: [], nonQualifying: [] }; }

describe("enforced Target HTTP context", () => {
  it("sends configured User-Agent even when a scanner proposes a different casing or value", async () => {
    await withTargetExecution(context(), async () => {
      const response = await probe(base, { headers: { "uSeR-aGeNt": "Scanner/incorrect" } });
      expect(response.status).toBe(200);
      expect(seen.at(-1)).toBe(context().requiredUserAgent);
      expect(executionHeaders({ "USER-AGENT": "wrong" }).get("user-agent")).toBe(context().requiredUserAgent);
    });
  });
  it("blocks missing context, discovered foreign hosts, credentials in URLs and redirects", async () => {
    const before = seen.length;
    expect((await probe(base)).status).toBe(0);
    await withTargetExecution(context(), async () => {
      expect((await probe(base.replace("127.0.0.1", "localhost"))).status).toBe(0);
      expect(() => assertExecutionUrl(base.replace("http://", "http://user:pass@"))).toThrow();
      expect((await probe(`${base}/redirect`)).status).toBe(302);
    });
    expect(seen.length).toBe(before + 1);
  });
  it("overrides CLI User-Agent proposals without shell interpolation or logging secrets", () => {
    withTargetExecution(context(), () => {
      for (const tool of ["httpx", "katana", "nuclei", "dalfox"]) {
        const args = enforcedToolArgs(tool, ["-H", "user-agent: wrong", "--user-agent", "wrong", "-headers=User-Agent: wrong", "--header=USER-AGENT: wrong", "-user-agent=wrong", "-H", "Cookie: secret"]);
        expect(args.join(" ")).not.toContain("wrong"); expect(args.join(" ")).toContain(context().requiredUserAgent);
        expect(safeCommandSummary(tool, args)).not.toContain("secret");
      }
      expect(enforcedToolArgs("nmap", ["-sV", "-A", "foreign.example"])).toEqual(["-sT", "-Pn", "-n", "127.0.0.1"]);
      expect(() => enforcedToolArgs("curl", [base])).toThrow(/Unaudited/);
      expect(() => enforcedToolArgs("ffuf", ["-u", base])).toThrow(/Unaudited/);
      expect(() => enforcedToolArgs("httpx", ["-H", "Cookie: fixture\r\nUser-Agent: wrong"])).toThrow(/Multiline/);
      expect(() => enforcedToolArgs("httpx", ["-u", "http://foreign.example"])).toThrow(/Scope/);
    });
  });
  it("rejects removed, excluded, wildcard and legacy hosts at the final execution gate", () => {
    const target = { host: "api.example.com", active: true, userId: "u", scope: { status: "APPROVED" }, program: { ownerId: "u", requiredUserAgent: "UA/1", outOfScope: [] as string[] } };
    expect(scanRejection(target)).toBeNull();
    expect(scanRejection({ ...target, active: false })).toMatch(/removed/);
    expect(scanRejection({ ...target, host: "*.example.com" })).toMatch(/concrete/);
    expect(scanRejection({ ...target, program: null })).toMatch(/User-Agent/);
    expect(scanRejection({ ...target, program: { ...target.program, outOfScope: ["*.example.com"] } })).toMatch(/out of scope/);
  });
});
