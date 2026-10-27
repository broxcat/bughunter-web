import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { chromium } from "playwright-chromium";
import { withTargetExecution, newTargetBrowserContext } from "@/server/execution";
import { prisma } from "@/lib/prisma";
import { runCommand } from "@/server/scanners/runCommand";
import { NUCLEI_TEMPLATE } from "@/server/scanners/toolPolicy";
import { acquireSessionCookies } from "@/server/credentials/autoLogin";

vi.mock("@/server/credentials", () => ({ loadTargetCredentials: vi.fn(async () => [{ id: "test", label: "Test account", cookies: { sessionid: "test" } }]) }));
vi.mock("@/server/scanners/context", () => ({ logLine: vi.fn(async () => {}), recordFinding: vi.fn(async () => {}) }));
vi.mock("@/server/queue/logBus", () => ({ publishScanLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({ prisma: { scanLog: { create: vi.fn(async () => {}) } } }));
const network = process.env.SCANNER_HTTP_TESTS === "1" ? describe : describe.skip;
network("real HTTP tools and Chromium capture", () => {
  let server: Server;
  let base: string;
  const seen: { ua: string | undefined; url: string | undefined; host: string | undefined }[] = [];
  const ua = "BugHunter-Program-Required/7.3 $(printf literal-argv)";
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ ua: req.headers["user-agent"], url: req.url, host: req.headers.host });
      res.setHeader("Content-Type", "text/html");
      if (req.url === "/redirect-chain") { res.writeHead(302, { Location: "/redirect" }); return res.end(); }
      if (req.url === "/redirect") { res.writeHead(302, { Location: `${base.replace("127.0.0.1", "localhost")}/foreign` }); return res.end(); }
      if (req.url === "/login") return res.end('<form action="/session" method="POST"><input type="email" name="email"><input type="password" name="password"><button type="submit">Sign in</button></form>');
      if (req.url === "/session") { res.setHeader("Set-Cookie", "sessionid=test; Path=/"); res.writeHead(302, { Location: "/redirect-chain" }); return res.end("signed in"); }
      if (req.url?.startsWith("/xss")) return res.end('<div id="out"></div><script>document.getElementById("out").innerHTML=new URLSearchParams(location.search).get("q")</script>');
      if (req.url?.startsWith("/private-xss")) {
        if (!req.headers.cookie?.includes("sessionid=test")) { res.writeHead(401); return res.end("unauthorized"); }
        return res.end('<div id="out"></div><script>document.getElementById("out").innerHTML=new URLSearchParams(location.search).get("q")</script>');
      }
      if (req.url?.startsWith("/dialog-echo")) return res.end('<script>alert(new URLSearchParams(location.search).get("q"))</script>');
      if (req.url === "/.git/config") return res.end("[core]\nrepositoryformatversion = 0");
      res.end('<!doctype html><a href="/redirect">redirect</a><a href="http://localhost:' + (server.address() as { port: number }).port + '/foreign">foreign</a><a href="/child">child</a><form action="/transfer" method="POST"><input name="amount" value="1"></form>');
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));
  const execution = () => ({ targetId: "network", host: new URL(base).host, requiredUserAgent: ua, qualifying: [], nonQualifying: [] });
  function assertReceived(from: number) {
    const requests = seen.slice(from);
    expect(requests.length).toBeGreaterThan(0);
    expect([...new Set(requests.map(r => r.ua))]).toEqual([ua]);
    expect(requests.some(r => r.host?.startsWith("localhost:"))).toBe(false);
  }
  for (const tool of ["httpx", "katana", "nuclei", "dalfox"]) {
    it(`${tool} sends the configured UA over real HTTP`, async () => {
      const from = seen.length;
      await withTargetExecution(execution(), async () => {
        const args = tool === "httpx" ? ["-silent", "-u", base, "-H", "User-Agent: Tool-Wrong"] :
          tool === "katana" ? ["-silent", "-u", base, "-d", "1", "-H", "User-Agent: Tool-Wrong"] :
          tool === "nuclei" ? ["-silent", "-duc", "-u", base, "-t", NUCLEI_TEMPLATE, "-H", "User-Agent: Tool-Wrong"] :
          ["url", `${base}/?q=hello`, "--silence", "--no-color", "--worker", "2", "--skip-mining-all", "--timeout", "2", "--user-agent", "Tool-Wrong"];
        const result = await runCommand(tool, args, { scanRunId: "fixture", timeoutMs: 45000 });
        expect(result).toEqual({ code: 0, timedOut: false });
        const output = vi.mocked(prisma.scanLog.create).mock.calls.map(call => call[0].data.line).join("\n");
        expect(output).not.toMatch(/Error parsing config file|invalid character '#'/i);
      });
      assertReceived(from);
    }, 50000);
  }
  it("Chromium enforces UA on page requests, fetch, redirects and subresources", async () => {
    const from = seen.length;
    await withTargetExecution(execution(), async () => {
      const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
      try {
        const context = await newTargetBrowserContext(browser);
        const page = await context.newPage();
        await page.goto(base);
        await page.goto(`${base}/redirect-chain`).catch(() => {});
        await page.goto(base);
        await page.evaluate(async () => { await fetch("/child", { headers: { "User-Agent": "Page-Wrong" } }); });
        const foreignCount = seen.filter(r => r.host?.startsWith("localhost:")).length;
        await page.goto(base.replace("127.0.0.1", "localhost")).catch(() => {});
        expect(seen.filter(r => r.host?.startsWith("localhost:")).length).toBe(foreignCount);
        await context.close();
      } finally { await browser.close(); }
    });
    assertReceived(from);
  }, 20000);




  it("real credential auto-login uses the program UA", async () => {
    const from = seen.length;
    const result = await withTargetExecution(execution(), () => acquireSessionCookies({ loginUrl: `${base}/login`, email: "test@example.com", password: "test" }));
    expect(result.cookies.sessionid).toBe("test"); assertReceived(from);
  }, 25000);
});
