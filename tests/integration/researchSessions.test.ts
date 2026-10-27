import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
let zip: typeof import("@/app/api/research-sessions/[id]/zip/route").GET;
let userId: string, otherId: string, targetId: string, root: string;
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const create = (extra = {}) => POST(new Request("http://app.example.test/api/research-sessions", { method: "POST", body: JSON.stringify({ targetId, ...extra }) }));
(db ? describe : describe.skip)("Research session ownership, persistence and legacy integration", () => {
  beforeAll(async () => {
    // A separate schema avoids interference with existing API suites' cleanups.
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: process.env, stdio: "pipe" });
    ({ prisma } = await import("@/lib/prisma"));
    ({ POST, GET } = await import("@/app/api/research-sessions/route"));
    ({ GET: detail } = await import("@/app/api/research-sessions/[id]/route"));
    ({ GET: zip } = await import("@/app/api/research-sessions/[id]/zip/route"));
    root = await mkdtemp(join(tmpdir(), "research-api-")); process.env.RESEARCH_WORKSPACE_ROOT = root;
    const owner = await prisma.user.create({ data: { email: "research-owner@example.test" } }); userId = owner.id;
    otherId = (await prisma.user.create({ data: { email: "research-other@example.test" } })).id;
  }, 30000);
  afterAll(async () => {
    if (prisma) {
      // Schema name is generated locally from UUID, never user input.
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await prisma.$disconnect();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    mocks.auth.mockResolvedValue({ user: { id: userId } }); mocks.log.mockClear();
    const program = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Synthetic Research", requiredUserAgent: "Research/1" } });
    const scope = await prisma.scope.create({ data: { userId, hostPattern: "app.example.test", status: "APPROVED" } });
    const target = await prisma.target.create({ data: { userId, scopeId: scope.id, programId: program.id, host: "app.example.test" } }); targetId = target.id;
  });
  it("creates an owned READY session, records Recon provenance and exports the expected files", async () => {
    const { researchRecon } = await import("../fixtures/research");
    const recon = await prisma.scanRun.create({ data: { targetId, type: "RECON", status: "COMPLETED", reconCorpus: researchRecon().reconCorpus } });
    const response = await create(); expect(response.status).toBe(201);
    const data = await response.json(); expect(data).toMatchObject({ status: "READY", targetId, reconScanRunId: recon.id });
    expect(await readFile(join(root, data.workspaceId, "scope.md"), "utf8")).toContain("app.example.test");
    expect((await detail(new Request("http://app.example.test"), context(data.id))).status).toBe(200);
    const download = await zip(new Request("http://app.example.test"), context(data.id));
    expect(download.status).toBe(200); expect(download.headers.get("Content-Type")).toBe("application/zip");
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await (await GET()).json()).some((s: { id: string }) => s.id === data.id)).toBe(true);
  });
  it("returns 404 for foreign targets, sessions, and ZIPs", async () => {
    const data = await (await create()).json();
    mocks.auth.mockResolvedValue({ user: { id: otherId } });
    expect((await create()).status).toBe(404);
    expect((await detail(new Request("http://app.example.test"), context(data.id))).status).toBe(404);
    expect((await zip(new Request("http://app.example.test"), context(data.id))).status).toBe(404);
    expect(await (await GET()).json()).toEqual([]);
  });
  it("requires authentication for creation, list, status and ZIP", async () => {
    mocks.auth.mockResolvedValue(null);
    for (const response of [await create(), await GET(), await detail(new Request("http://app.example.test"), context("missing")), await zip(new Request("http://app.example.test"), context("missing"))]) expect(response.status).toBe(401);
  });
  it.each(["revoked", "wildcard", "excluded", "removed", "mismatched"])("refuses %s authorization without publishing a session", async reason => {
    const t = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
    if (reason === "revoked") await prisma.scope.update({ where: { id: t.scopeId }, data: { status: "REVOKED" } });
    if (reason === "wildcard") await prisma.target.update({ where: { id: targetId }, data: { host: "*.example.test" } });
    if (reason === "excluded") await prisma.bountyProgram.update({ where: { id: t.programId! }, data: { outOfScope: ["*.example.test"] } });
    if (reason === "removed") await prisma.target.update({ where: { id: targetId }, data: { active: false } });
    if (reason === "mismatched") await prisma.scope.update({ where: { id: t.scopeId }, data: { hostPattern: "other.example.test" } });
    expect((await create()).status).toBe(400);
    expect(await prisma.researchSession.count({ where: { targetId } })).toBe(0);
  });
  it.each([{ path: "/tmp/user-selected" }, { workspaceId: "../other" }, { command: "codex --yolo" }])("refuses client filesystem/command input %j", async input => {
    expect((await create(input)).status).toBe(400);
    expect(await prisma.researchSession.count({ where: { targetId } })).toBe(0);
  });
  it("two concurrent creations remain distinct and preserve previous workspaces", async () => {
    const first = await (await create()).json(), before = await readFile(join(root, first.workspaceId, "scope.md"));
    const responses = await Promise.all([create(), create()]); expect(responses.map(r => r.status)).toEqual([201, 201]);
    const sessions = await Promise.all(responses.map(r => r.json()));
    expect(new Set([first.workspaceId, ...sessions.map(s => s.workspaceId)]).size).toBe(3);
    expect(await readFile(join(root, first.workspaceId, "scope.md"))).toEqual(before);
  });
  it("keeps credentials/AI ciphertext and plaintext out of files, ZIP, responses and logs", async () => {
    await prisma.targetCredential.create({ data: { targetId, label: "Account A", purpose: "ACCOUNT_A", cookiesCipher: "fixture-cookie-cipher", headerCipher: "fixture-bearer-cipher", emailCipher: "fixture-email-cipher", passwordCipher: "fixture-password-cipher", sessionCookiesCipher: "fixture-session-cipher" } });
    await prisma.aiProviderConfig.create({ data: { userId, provider: "OPENAI", apiKeyCipher: "fixture-ai-key-cipher" } });
    const response = await create(), data = await response.json(); expect(response.status).toBe(201);
    const outputs = [JSON.stringify(data), JSON.stringify(mocks.log.mock.calls)];
    for (const name of data.files) outputs.push(await readFile(join(root, data.workspaceId, name), "utf8"));
    const archive = await zip(new Request("http://app.example.test"), context(data.id)); outputs.push(Buffer.from(await archive.arrayBuffer()).toString());
    for (const output of outputs) expect(output).not.toMatch(/fixture-(cookie|bearer|email|password|session|ai-key)-cipher|apiKeyCipher|cookiesCipher|passwordCipher|headerCipher/);
  });
  it("downloads stay intact after a workspace symlink is added, and detect archive replacement", async () => {
    const s = await (await create()).json();
    await symlink("/etc/passwd", join(root, s.workspaceId, "evidence/escape"));
    expect((await zip(new Request("http://app.example.test"), context(s.id))).status).toBe(200);
    const dbSession = await prisma.researchSession.findUniqueOrThrow({ where: { id: s.id } });
    await prisma.researchSession.update({ where: { id: s.id }, data: { exportSha256: "invalid" } });
    expect((await zip(new Request("http://app.example.test"), context(s.id))).status).toBe(409);
    await prisma.researchSession.update({ where: { id: s.id }, data: { exportSha256: dbSession.exportSha256 } });
  });
  it("records a safe FAILED session when filesystem publication is refused", async () => {
    const unsafe = join(root, "unsafe-root");
    await symlink(tmpdir(), unsafe);
    process.env.RESEARCH_WORKSPACE_ROOT = unsafe;
    try {
      const response = await create(); expect(response.status).toBe(400);
      const failed = await prisma.researchSession.findFirstOrThrow({ where: { targetId } });
      expect(failed.status).toBe("FAILED"); expect(failed.exportSha256).toBeNull();
      expect((await zip(new Request("http://app.example.test"), context(failed.id))).status).toBe(409);
      expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(root);
    } finally { process.env.RESEARCH_WORKSPACE_ROOT = root; }
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
    await create();
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).huntReport).toEqual(report);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } })).scanRunId).toBe(run.id);
    expect(await prisma.report.findUnique({ where: { id: savedReport.id } })).not.toBeNull();
  });
});
