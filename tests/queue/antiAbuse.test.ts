// Real disposable PostgreSQL/Redis only: provisioned by npm run test:queue.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Redis } from "ioredis";
import { rateLimit } from "@/lib/rateLimit";
import { guardCredentials } from "@/lib/credentialsGuard";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth }));
const exec = promisify(execFile);
const dbUrl = process.env.TEST_ABUSE_DATABASE_URL, redisUrl = process.env.TEST_ABUSE_REDIS_URL, container = process.env.TEST_ABUSE_REDIS_CONTAINER;
let prisma: typeof import("@/lib/prisma")["prisma"];
let scanPost: typeof import("@/app/api/scan-runs/route")["POST"];
let registerPost: typeof import("@/app/api/register/route")["POST"];
let createScanRequest: typeof import("@/server/queue/scanRequest")["createScanRequest"];
let owner: { id: string; targetId: string };
async function fixture() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@abuse.example.test` } });
  const program = await prisma.bountyProgram.create({ data: { ownerId: user.id, companyName: "Disposable anti-abuse test", requiredUserAgent: "AbuseTest/1" } });
  const scope = await prisma.scope.create({ data: { userId: user.id, hostPattern: "abuse.example.test", status: "APPROVED" } });
  const target = await prisma.target.create({ data: { userId: user.id, scopeId: scope.id, programId: program.id, host: "abuse.example.test" } });
  return { id: user.id, targetId: target.id };
}
const input = (targetId = owner.targetId) => ({ targetId, type: "RECON" as const, approvedTechniques: [] });
const postScan = (key: string) => scanPost(new NextRequest("http://localhost/api/scan-runs", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key, "x-forwarded-for": randomUUID() }, body: JSON.stringify(input()) }));
const postRegister = () => registerPost(new Request("http://localhost/api/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Fixture", email: `${randomUUID()}@example.test`, password: "fixture-password" }) }));
async function redisReady() {
  const client = new Redis(redisUrl!, { maxRetriesPerRequest: 0, connectTimeout: 500, lazyConnect: true, retryStrategy: () => null }); client.on("error", () => {});
  try { await client.connect(); await client.ping(); } finally { client.disconnect(); }
}
describe.skipIf(!dbUrl || !redisUrl || !container)("real anti-abuse quotas and operation outage policies", () => {
  beforeAll(async () => {
    const label = (await exec("docker", ["inspect", "--format", '{{index .Config.Labels "bughunter.queue-test"}}', container!])).stdout.trim();
    if (label !== "disposable") throw new Error("Refusing to alter a non-disposable Redis service");
    vi.stubEnv("DATABASE_URL", dbUrl!); vi.stubEnv("REDIS_URL", redisUrl!); vi.stubEnv("AUTH_SECRET", "disposable-anti-abuse-secret");
    vi.stubEnv("ALLOW_PUBLIC_REGISTRATION", "true"); vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    await exec("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: dbUrl }, timeout: 30_000 });
    ({ prisma } = await import("@/lib/prisma"));
    ({ POST: scanPost } = await import("@/app/api/scan-runs/route"));
    ({ POST: registerPost } = await import("@/app/api/register/route"));
    ({ createScanRequest } = await import("@/server/queue/scanRequest"));
    owner = await fixture(); auth.mockResolvedValue({ user: { id: owner.id } });
  }, 60_000);
  afterAll(async () => { if (prisma) await prisma.$disconnect(); vi.unstubAllEnvs(); });
  it("atomically enforces a shared Redis window across concurrent clients", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => rateLimit(`rl:fixture:atomic`, 5, 60)));
    expect(results.filter(result => result.status === "ALLOWED")).toHaveLength(5);
    expect(results.filter(result => result.status === "BLOCKED")).toHaveLength(7);
    const result = await rateLimit("rl:fixture:atomic", 5, 60);
    expect(result).toMatchObject({ status: "BLOCKED", remaining: 0 });
    if (result.status !== "UNAVAILABLE") expect(result.resetSec).toBeGreaterThan(0);
  });
  it("limits login accounts independently of source IP, before any password check", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    try {
      for (let n = 0; n < 8; n++) await guardCredentials(new Request("http://localhost", { headers: { "x-forwarded-for": `192.0.2.${n + 1}` } }), "Distributed@Example.test");
      await expect(guardCredentials(new Request("http://localhost", { headers: { "x-forwarded-for": "192.0.2.99" } }), " distributed@example.test ")).rejects.toMatchObject({ code: "rate_limited" });
    } finally { vi.stubEnv("TRUST_PROXY_HEADERS", "false"); }
  });
  it("cannot fragment the IP quota by forging headers and rotating account names", async () => {
    const isolated = new URL(redisUrl!); isolated.pathname = "/1";
    vi.stubEnv("REDIS_URL", isolated.toString());
    try {
      for (let n = 0; n < 20; n++) {
        await guardCredentials(new Request("http://localhost", { headers: { "x-forwarded-for": `203.0.113.${n + 1}`, "x-real-ip": `198.51.100.${n + 1}` } }), `rotating-${n}@example.test`);
      }
      await expect(guardCredentials(new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.100", "x-real-ip": "198.51.100.100" } }), "another-account@example.test")).rejects.toMatchObject({ code: "rate_limited" });
    } finally { vi.stubEnv("REDIS_URL", redisUrl!); }
  });
  it("uses PostgreSQL serialization for concurrent scan creation at the quota boundary", async () => {
    const user = await fixture();
    await prisma.scanRun.createMany({ data: Array.from({ length: 19 }, () => ({ targetId: user.targetId, type: "RECON" as const })) });
    const results = await Promise.allSettled(["boundary-a", "boundary-b"].map(key => createScanRequest(user.id, input(user.targetId), key)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { name: "Error", message: "Too many scan runs. Please try again later." } });
    expect(await prisma.scanRun.count({ where: { targetId: user.targetId } })).toBe(20);
    expect(await prisma.scanJobOutbox.count({ where: { scanRun: { targetId: user.targetId } } })).toBe(1);
  });
  it("does not charge a second PostgreSQL quota slot for concurrent idempotent replays", async () => {
    const user = await fixture();
    await prisma.scanRun.createMany({ data: Array.from({ length: 19 }, () => ({ targetId: user.targetId, type: "RECON" as const })) });
    const [a, b] = await Promise.all([1, 2].map(() => createScanRequest(user.id, input(user.targetId), "same-key-at-limit")));
    expect(a.id).toBe(b.id); expect(await prisma.scanRun.count({ where: { targetId: user.targetId } })).toBe(20);
  });
  it("excludes expired scans and isolates quotas by user", async () => {
    const user = await fixture();
    await prisma.scanRun.createMany({ data: Array.from({ length: 25 }, () => ({ targetId: user.targetId, type: "RECON" as const, createdAt: new Date(Date.now() - 3_600_001) })) });
    await expect(createScanRequest(user.id, input(user.targetId), "fresh-window")).resolves.toMatchObject({ status: "QUEUED" });
  });
  it("fails closed for login but accepts bounded, durable scan work through a real Redis outage", async () => {
    await exec("docker", ["stop", "-t", "0", container!], { timeout: 20_000 });
    try {
      const start = Date.now();
      await expect(guardCredentials(new Request("http://localhost"), "outage@example.test")).rejects.toMatchObject({ code: "temporarily_unavailable" });
      // Registration carries no quota, so an outage never refuses a signup.
      expect((await postRegister()).status).toBe(200);
      const response = await postScan("redis-outage"), run = await response.json();
      expect(response.status).toBe(202); expect(Date.now() - start).toBeLessThan(6000);
      expect(run).toMatchObject({ status: "QUEUED", outcome: null, dispatch: "PENDING" });
      expect(await prisma.scanJobOutbox.findUnique({ where: { scanRunId: run.id } })).toMatchObject({ status: "PENDING" });
      await prisma.scanRun.createMany({ data: Array.from({ length: 19 }, () => ({ targetId: owner.targetId, type: "RECON" as const })) });
      const denied = await postScan("over-durable-quota"); expect(denied.status).toBe(429); expect(denied.headers.get("Retry-After")).toBeTruthy();
      // The same accepted request remains retrievable even after quota exhaustion.
      expect((await (await postScan("redis-outage")).json()).id).toBe(run.id);
      expect(await prisma.scanRun.count({ where: { targetId: owner.targetId } })).toBe(20);
    } finally {
      await exec("docker", ["start", container!], { timeout: 20_000 });
      let ready = false;
      for (let n = 0; n < 30 && !ready; n++) { try { await redisReady(); ready = true; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
      expect(ready).toBe(true);
    }
    const { dispatchPendingScanJobs } = await import("@/server/queue/scanDispatcher");
    await prisma.scanJobOutbox.updateMany({ where: { status: "PENDING" }, data: { nextAttemptAt: new Date(0) } });
    await dispatchPendingScanJobs();
    const pending = await prisma.scanJobOutbox.count({ where: { scanRun: { targetId: owner.targetId }, status: "PENDING" } });
    expect(pending).toBe(0);
    expect((await postRegister()).status).toBe(200);
  }, 30_000);
});
