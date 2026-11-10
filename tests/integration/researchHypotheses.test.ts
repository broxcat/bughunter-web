import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hypothesisFixture } from "../fixtures/hypotheses";
import { createHistoricalHypothesis, createHistoricalSession } from "../fixtures/researchHistory";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
const db = process.env.TEST_DATABASE_URL, schema = `hypotheses_${randomUUID().replaceAll("-", "")}`;
if (db) { const url = new URL(db); url.searchParams.set("schema", schema); process.env.DATABASE_URL = url.toString(); }
let prisma: typeof import("@/lib/prisma").prisma;
let list: typeof import("@/app/api/research-sessions/[id]/hypotheses/route").GET;
let detail: typeof import("@/app/api/research-sessions/[id]/hypotheses/[hypothesisId]/route").GET;
let userId: string, otherId: string, targetId: string;
let session: Awaited<ReturnType<typeof createHistoricalSession>>;
const ctx = () => ({ params: Promise.resolve({ id: session.id }) });
const request = () => new Request("http://app.example.test");
const add = (overrides: Parameters<typeof hypothesisFixture>[0] = {}) => createHistoricalHypothesis(prisma, session.id, hypothesisFixture(overrides));
// Workspace import was retired with the Research console; the registry stays readable.
(db ? describe : describe.skip)("historical hypothesis registry — actual PostgreSQL", () => {
  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: process.env, stdio: "pipe" });
    ({ prisma } = await import("@/lib/prisma"));
    ({ GET: list } = await import("@/app/api/research-sessions/[id]/hypotheses/route"));
    ({ GET: detail } = await import("@/app/api/research-sessions/[id]/hypotheses/[hypothesisId]/route"));
    otherId = (await prisma.user.create({ data: { email: "other@example.test" } })).id;
  }, 30000);
  beforeEach(async () => {
    userId = (await prisma.user.create({ data: { email: `${randomUUID()}@example.test` } })).id;
    mocks.auth.mockResolvedValue({ user: { id: userId } });
    const scope = await prisma.scope.create({ data: { userId, hostPattern: "app.example.test", status: "APPROVED" } });
    const program = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Registry fixture", requiredUserAgent: "Registry/1" } });
    targetId = (await prisma.target.create({ data: { userId, scopeId: scope.id, programId: program.id, host: "app.example.test" } })).id;
    session = await createHistoricalSession(prisma, userId, targetId);
  });
  afterAll(async () => {
    if (prisma) { await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await prisma.$disconnect(); }
  });
  it("protects list/detail and revision snapshots from another user or another session", async () => {
    const h = await add();
    mocks.auth.mockResolvedValue({ user: { id: otherId } });
    expect((await list(request(), ctx())).status).toBe(404);
    expect((await detail(request(), { params: Promise.resolve({ id: session.id, hypothesisId: h.id }) })).status).toBe(404);
    mocks.auth.mockResolvedValue({ user: { id: userId } });
    const different = await createHistoricalSession(prisma, userId, targetId);
    expect((await detail(request(), { params: Promise.resolve({ id: different.id, hypothesisId: h.id }) })).status).toBe(404);
    mocks.auth.mockResolvedValue(null); expect((await list(request(), ctx())).status).toBe(401);
  });
  it("keeps historical hypotheses readable after scope revocation and archival", async () => {
    const h = await add();
    await prisma.scope.updateMany({ where: { userId }, data: { status: "REVOKED" } });
    await prisma.researchSession.update({ where: { id: session.id }, data: { status: "ARCHIVED" } });
    expect((await list(request(), ctx())).status).toBe(200);
    expect((await detail(request(), { params: Promise.resolve({ id: session.id, hypothesisId: h.id }) })).status).toBe(200);
  });
  it("redacts known secrets in stored hypotheses and every revision snapshot", async () => {
    await add({ notes: "Authorization: Bearer NEVER_STORE_TOKEN\nCookie: NEVER_STORE_COOKIE\npassword=NEVER_STORE_PASSWORD", evidenceFor: [{ ref: "evidence/observation.txt", summary: "apiKey=sk-NEVER_STORE_API_KEY" }] });
    const h = await prisma.researchHypothesis.findFirstOrThrow({ where: { sessionId: session.id }, include: { revisions: true } });
    expect(JSON.stringify(h)).not.toMatch(/NEVER_STORE_/);
  });
  it("enforces logical uniqueness in PostgreSQL and cascades revisions only with session deletion", async () => {
    const h = await add();
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = h; void _id; void _createdAt; void _updatedAt;
    await expect(prisma.researchHypothesis.create({ data: { ...copy, researchData: undefined, evidenceFor: [], evidenceAgainst: [] } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.researchHypothesisRevision.create({ data: { hypothesisId: h.id, revision: 1, snapshot: {} } })).rejects.toMatchObject({ code: "P2002" });
    await prisma.researchSession.delete({ where: { id: session.id } });
    expect(await prisma.researchHypothesis.findUnique({ where: { id: h.id } })).toBeNull();
    expect(await prisma.researchHypothesisRevision.count({ where: { hypothesisId: h.id } })).toBe(0);
  });
  it("exposes bounded sorted/filterable lists and owned revision snapshots", async () => {
    await add({ externalId: "H-010", status: "REJECTED", notes: "Independent controls rejected this path" }); await add({ externalId: "H-002" }); const first = await add();
    const body = await (await list(new Request("http://app.example.test?status=OPEN"), ctx())).json();
    expect(body.total).toBe(2); expect(body.counts).toMatchObject({ OPEN: 2, REJECTED: 1 }); expect(body.hypotheses.map((h: { externalId: string }) => h.externalId)).toEqual(["H-001", "H-002"]);
    expect((await list(new Request("http://app.example.test?status=LIKELY"), ctx())).status).toBe(400);
    const d = await detail(request(), { params: Promise.resolve({ id: session.id, hypothesisId: first.id }) });
    expect((await d.json()).hypothesis.revisions).toHaveLength(1);
  });
});
