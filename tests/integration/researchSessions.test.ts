import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createHistoricalSession } from "../fixtures/researchHistory";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.log, info: mocks.log, warn: mocks.log } }));
const db = process.env.TEST_DATABASE_URL;
const schema = `research_${randomUUID().replaceAll("-", "")}`;
if (db) { const u = new URL(db); u.searchParams.set("schema", schema); process.env.DATABASE_URL = u.toString(); }
let prisma: typeof import("@/lib/prisma").prisma;
let POST: typeof import("@/app/api/research-sessions/route").POST;
let GET: typeof import("@/app/api/research-sessions/route").GET;
let detail: typeof import("@/app/api/research-sessions/[id]/route").GET;
let userId: string, otherId: string, targetId: string;
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const create = (extra = {}) => POST(new Request("http://app.example.test/api/research-sessions", { method: "POST", body: JSON.stringify({ targetId, ...extra }) }));
(db ? describe : describe.skip)("Retired Research sessions: creation gone, history readable and owned", () => {
  beforeAll(async () => {
    // A separate schema avoids interference with existing API suites' cleanups.
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: process.env, stdio: "pipe" });
    ({ prisma } = await import("@/lib/prisma"));
    ({ POST, GET } = await import("@/app/api/research-sessions/route"));
    ({ GET: detail } = await import("@/app/api/research-sessions/[id]/route"));
    const owner = await prisma.user.create({ data: { email: "research-owner@example.test" } }); userId = owner.id;
    otherId = (await prisma.user.create({ data: { email: "research-other@example.test" } })).id;
  }, 30000);
  afterAll(async () => {
    if (prisma) {
      // Schema name is generated locally from UUID, never user input.
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await prisma.$disconnect();
    }
  });
  beforeEach(async () => {
    mocks.auth.mockResolvedValue({ user: { id: userId } }); mocks.log.mockClear();
    const program = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Synthetic Research", requiredUserAgent: "Research/1" } });
    const scope = await prisma.scope.create({ data: { userId, hostPattern: "app.example.test", status: "APPROVED" } });
    const target = await prisma.target.create({ data: { userId, scopeId: scope.id, programId: program.id, host: "app.example.test" } }); targetId = target.id;
  });
  it.each([{}, { path: "/tmp/user-selected" }, { command: "codex --yolo" }])("answers 410 for creation %j without writing a session", async input => {
    const response = await create(input); expect(response.status).toBe(410);
    expect((await response.json()).error).toContain("local CLI");
    expect(await prisma.researchSession.count({ where: { targetId } })).toBe(0);
  });
  it("requires authentication for creation, list and status", async () => {
    mocks.auth.mockResolvedValue(null);
    for (const response of [await create(), await GET(), await detail(new Request("http://app.example.test"), context("missing"))]) expect(response.status).toBe(401);
  });
  it("lists and reads historical sessions for the owner only", async () => {
    const historical = await createHistoricalSession(prisma, userId, targetId, { data: { status: "ARCHIVED" } });
    expect((await (await GET()).json()).some((s: { id: string }) => s.id === historical.id)).toBe(true);
    const own = await detail(new Request("http://app.example.test"), context(historical.id));
    expect(own.status).toBe(200); expect(await own.json()).toMatchObject({ id: historical.id, status: "ARCHIVED", scopeMarkdown: "# Historical scope" });
    mocks.auth.mockResolvedValue({ user: { id: otherId } });
    expect((await detail(new Request("http://app.example.test"), context(historical.id))).status).toBe(404);
    expect(await (await GET()).json()).toEqual([]);
  });
  it("keeps credentials and AI ciphertext out of historical session responses and logs", async () => {
    await prisma.targetCredential.create({ data: { targetId, label: "Account A", purpose: "ACCOUNT_A", cookiesCipher: "fixture-cookie-cipher", headerCipher: "fixture-bearer-cipher", emailCipher: "fixture-email-cipher", passwordCipher: "fixture-password-cipher", sessionCookiesCipher: "fixture-session-cipher" } });
    await prisma.aiProviderConfig.create({ data: { userId, provider: "OPENAI", apiKeyCipher: "fixture-ai-key-cipher" } });
    const historical = await createHistoricalSession(prisma, userId, targetId);
    const outputs = [JSON.stringify(await (await GET()).json()), JSON.stringify(await (await detail(new Request("http://app.example.test"), context(historical.id))).json()), JSON.stringify(mocks.log.mock.calls)];
    for (const output of outputs) expect(output).not.toMatch(/fixture-(cookie|bearer|email|password|session|ai-key)-cipher|apiKeyCipher|cookiesCipher|passwordCipher|headerCipher/);
  });
  it("new HUNT is refused while old Hunt reports, findings and reports remain unchanged", async () => {
    const { POST: scan } = await import("@/app/api/scan-runs/route");
    const { NextRequest } = await import("next/server");
    expect((await scan(new NextRequest("http://app.example.test", { method: "POST", body: JSON.stringify({ targetId, type: "HUNT" }) }))).status).toBe(410);
    const { POST: cancel } = await import("@/app/api/scan-runs/[id]/cancel/route");
    const queued = await prisma.scanRun.create({ data: { targetId, type: "HUNT" } });
    expect((await cancel(new Request("http://app.example.test"), context(queued.id))).status).toBe(409);
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: queued.id } })).cancelRequestedAt).toBeNull();
    const report = { version: 1, families: [], candidates: [], techniques: [], requests: 3, limits: {}, status: "COMPLETED" };
    const run = await prisma.scanRun.create({ data: { targetId, type: "HUNT", status: "COMPLETED", huntReport: report, huntSnapshot: { version: 1 }, approvedHuntTechniques: ["old-technique"] } });
    const finding = await prisma.finding.create({ data: { targetId, scanRunId: run.id, title: "Historical finding", gateStatus: "PASSED" } });
    const savedReport = await prisma.report.create({ data: { userId, targetId, title: "Historical report", items: { create: { findingId: finding.id } } } });
    const { GET: history } = await import("@/app/api/scan-runs/[id]/hunt/route");
    expect(await (await history(new Request("http://app.example.test"), context(run.id))).json()).toMatchObject({ huntReport: report });
    expect((await create()).status).toBe(410);
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).huntReport).toEqual(report);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } })).scanRunId).toBe(run.id);
    expect(await prisma.report.findUnique({ where: { id: savedReport.id } })).not.toBeNull();
  });
});
