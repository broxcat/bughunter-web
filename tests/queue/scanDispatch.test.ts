// Infrastructure coverage is enabled by `npm run test:queue`, which provisions
// isolated PostgreSQL and Redis containers, runs this suite and removes them.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => ({ status: "ALLOWED" })) }));
const exec = promisify(execFile);
const dbUrl = process.env.TEST_QUEUE_DATABASE_URL;
const redisUrl = process.env.TEST_QUEUE_REDIS_URL;
const redisContainer = process.env.TEST_QUEUE_REDIS_CONTAINER;
let prisma: typeof import("@/lib/prisma")["prisma"];
let POST: typeof import("@/app/api/scan-runs/route")["POST"];
let GET: typeof import("@/app/api/scan-runs/route")["GET"];
let createScanRequest: typeof import("@/server/queue/scanRequest")["createScanRequest"];
let publishScanJob: typeof import("@/server/queue/scanJobPublisher")["publishScanJob"];
let dispatchPendingScanJobs: typeof import("@/server/queue/scanDispatcher")["dispatchPendingScanJobs"];
let startScanDispatcher: typeof import("@/server/queue/scanDispatcher")["startScanDispatcher"];
let owner: { id: string; targetId: string };
async function fixture() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@queue.example.test` } });
  const program = await prisma.bountyProgram.create({ data: { ownerId: user.id, companyName: "Disposable queue test", requiredUserAgent: "QueueTest/1" } });
  const scope = await prisma.scope.create({ data: { userId: user.id, hostPattern: "queue.example.test", status: "APPROVED" } });
  const target = await prisma.target.create({ data: { userId: user.id, scopeId: scope.id, programId: program.id, host: "queue.example.test" } });
  return { id: user.id, targetId: target.id };
}
function input(targetId = owner.targetId) { return { targetId, type: "RECON" as const, approvedTechniques: [] }; }
function post(key?: string, targetId = owner.targetId) {
  return POST(new NextRequest("http://localhost/api/scan-runs", { method: "POST", headers: { "Content-Type": "application/json", ...(key === undefined ? {} : { "Idempotency-Key": key }) }, body: JSON.stringify(input(targetId)) }));
}
async function withQueue<T>(work: (queue: Queue) => Promise<T>) {
  const connection = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 500, commandTimeout: 1000 });
  connection.on("error", () => {});
  await connection.connect();
  const queue = new Queue("scans", { connection }); queue.on("error", () => {});
  try { return await work(queue); } finally { await queue.close(); connection.disconnect(); }
}
async function redisCommand(command: "stop" | "start" | "pause" | "unpause") {
  // A bad environment variable must never stop somebody's real Redis.
  const { stdout } = await exec("docker", ["inspect", "--format", '{{ index .Config.Labels "bughunter.queue-test" }}', redisContainer!]);
  expect(stdout.trim()).toBe("disposable");
  await exec("docker", command === "stop" ? ["stop", "-t", "0", redisContainer!] : [command, redisContainer!]);
}
async function waitForPublished(id: string) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const row = await prisma.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId: id } });
    if (row.status === "PUBLISHED") return row;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Dispatcher did not recover pending scan");
}
async function rejectPublication(enabled: boolean) {
  if (enabled) {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_queue_test_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'PUBLISHED' THEN RAISE EXCEPTION 'simulated crash after Redis'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_queue_test_publication BEFORE UPDATE ON "ScanJobOutbox" FOR EACH ROW EXECUTE FUNCTION reject_queue_test_publication()`);
  } else {
    await prisma.$executeRawUnsafe(`DROP TRIGGER reject_queue_test_publication ON "ScanJobOutbox"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION reject_queue_test_publication()`);
  }
}
describe.skipIf(!dbUrl || !redisUrl || !redisContainer)("real PostgreSQL + BullMQ delivery", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = dbUrl!; process.env.REDIS_URL = redisUrl!;
    await exec("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: dbUrl }, timeout: 30_000 });
    ({ prisma } = await import("@/lib/prisma"));
    ({ POST, GET } = await import("@/app/api/scan-runs/route"));
    ({ createScanRequest } = await import("@/server/queue/scanRequest"));
    ({ publishScanJob } = await import("@/server/queue/scanJobPublisher"));
    ({ dispatchPendingScanJobs, startScanDispatcher } = await import("@/server/queue/scanDispatcher"));
    owner = await fixture(); auth.mockResolvedValue({ user: { id: owner.id } });
  }, 60_000);
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });
  it("atomically creates ScanRun/outbox, publishes deterministic job ID and retains execution policy", async () => {
    const response = await post(); const run = await response.json();
    expect(response.status).toBe(201); expect(run).toMatchObject({ status: "QUEUED", outcome: null, dispatch: "PUBLISHED", jobId: run.id });
    const intent = await prisma.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId: run.id } });
    expect(intent).toMatchObject({ status: "PUBLISHED", attempts: 1, lastError: null });
    await withQueue(async queue => {
      const job = await queue.getJob(run.id);
      expect(job?.data).toEqual({ scanRunId: run.id, targetId: owner.targetId, type: "RECON" });
      expect(job?.opts).toMatchObject({ attempts: 1, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800 } });
    });
    await expect(prisma.scanJobOutbox.create({ data: { scanRunId: run.id } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("rolls back the scan and key if the outbox insert fails in PostgreSQL", async () => {
    const before = await prisma.scanRun.count();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_queue_test_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated DB failure before acceptance'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_queue_test_insert BEFORE INSERT ON "ScanJobOutbox" FOR EACH ROW EXECUTE FUNCTION reject_queue_test_insert()`);
    try {
      const response = await post("rollback-key"); expect(response.status).toBe(500);
      expect(await prisma.scanRun.count()).toBe(before);
      expect(await prisma.scanRequestKey.count({ where: { key: "rollback-key" } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER reject_queue_test_insert ON "ScanJobOutbox"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION reject_queue_test_insert()`);
    }
  });
  it("stopped Redis gives a bounded HTTP 202 and the running dispatcher recovers after restart", async () => {
    await redisCommand("stop");
    const dispatcher = startScanDispatcher(100);
    let id: string;
    try {
      const start = performance.now(); const response = await post("redis-outage"); const run = await response.json(); id = run.id;
      expect(performance.now() - start).toBeLessThan(4000);
      expect(response.status).toBe(202); expect(run).toMatchObject({ status: "QUEUED", outcome: null, jobId: null, dispatch: "PENDING" });
      expect(await prisma.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId: id } })).toMatchObject({ status: "PENDING", lastError: "QUEUE_DELIVERY_UNCONFIRMED", attempts: 1, nextAttemptAt: expect.any(Date) });
    } finally { await redisCommand("start"); }
    try {
      const row = await waitForPublished(id!); expect(row.attempts).toBeGreaterThanOrEqual(2);
      await withQueue(async queue => { expect((await queue.getJob(id!))?.id).toBe(id!); });
    } finally { await dispatcher.close(); }
  }, 20_000);
  it("a Redis process accepting TCP but not answering commands cannot hang publication", async () => {
    await redisCommand("pause");
    try {
      const start = performance.now(); const response = await post("redis-hang");
      expect(response.status).toBe(202); expect(performance.now() - start).toBeLessThan(4000);
    } finally { await redisCommand("unpause"); }
    // This intent is retried along with the next batch, after its backoff.
  }, 10_000);
  it("reconciles a crash after BullMQ accepts the job but before PostgreSQL acknowledges it", async () => {
    const run = await createScanRequest(owner.id, input(), "crash-window");
    await rejectPublication(true);
    try { expect((await publishScanJob(run.id)).dispatch).toBe("PENDING"); }
    finally { await rejectPublication(false); }
    expect((await prisma.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId: run.id } })).status).toBe("PENDING");
    await withQueue(async queue => { expect((await queue.getJob(run.id))?.id).toBe(run.id); });
    await dispatchPendingScanJobs();
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).jobId).toBe(run.id);
    expect((await prisma.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId: run.id } })).status).toBe("PUBLISHED");
    await withQueue(async queue => { expect((await queue.getJobs(["wait", "active", "completed", "failed"])).filter(job => job.id === run.id)).toHaveLength(1); });
  });
  it("multiple dispatchers and repeated publications create one effective job", async () => {
    const run = await createScanRequest(owner.id, input(), "multi-dispatcher");
    await Promise.all(Array.from({ length: 8 }, () => publishScanJob(run.id)));
    expect((await publishScanJob(run.id)).dispatch).toBe("PUBLISHED");
    const row = await prisma.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId: run.id } });
    expect(row.attempts).toBe(1);
    await withQueue(async queue => { expect((await queue.getJobs(["wait"])).filter(job => job.id === run.id)).toHaveLength(1); });
  });
  it("row locks skip busy publishers and are released on rollback, without stuck PUBLISHING", async () => {
    const run = await createScanRequest(owner.id, input(), "locked-row");
    let release!: () => void; let signalLocked!: () => void;
    const ready = new Promise<void>(resolve => { signalLocked = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const transaction = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ScanJobOutbox" WHERE "scanRunId" = ${run.id} FOR UPDATE`;
      signalLocked(); await hold; throw new Error("publisher crashed");
    }).catch(() => {});
    await ready;
    try { expect((await publishScanJob(run.id)).dispatch).toBe("PENDING"); }
    finally { release(); await transaction; }
    expect((await publishScanJob(run.id)).dispatch).toBe("PUBLISHED");
  });
  it("same user/key repeated or concurrent returns the same scan, outbox and job", async () => {
    const before = await prisma.scanRun.count();
    const responses = await Promise.all(Array.from({ length: 8 }, () => post("same-request")));
    const runs = await Promise.all(responses.map(response => response.json()));
    expect(responses.every(response => [201, 202].includes(response.status))).toBe(true);
    expect(new Set(runs.map(run => run.id)).size).toBe(1);
    expect(await prisma.scanRun.count()).toBe(before + 1);
    expect(await prisma.scanJobOutbox.count({ where: { scanRunId: runs[0].id } })).toBe(1);
    expect((await (await post("same-request")).json()).id).toBe(runs[0].id);
    await withQueue(async queue => { expect((await queue.getJobs(["wait"])).filter(job => job.id === runs[0].id)).toHaveLength(1); });
  });
  it("different users have independent keys, and different keys create independent scans", async () => {
    const a = await (await post("shared-key")).json(); const b = await (await post("other-key")).json();
    expect(a.id).not.toBe(b.id);
    const other = await fixture(); auth.mockResolvedValue({ user: { id: other.id } });
    try {
      const c = await (await post("shared-key", other.targetId)).json();
      expect(c.id).not.toBe(a.id); expect(c.targetId).toBe(other.targetId);
    } finally { auth.mockResolvedValue({ user: { id: owner.id } }); }
  });
  it("a replay with different parameters conflicts without creating work", async () => {
    await post("conflicting-key");
    const response = await POST(new NextRequest("http://localhost/api/scan-runs", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "conflicting-key" }, body: JSON.stringify({ targetId: "different-owned-target", type: "RECON" }) }));
    expect(response.status).toBe(409);
  });
  it.each(["RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const)("never republishes a %s scan after its BullMQ job was removed", async status => {
    const run = await createScanRequest(owner.id, input(), `terminal-${status}`);
    await prisma.scanRun.update({ where: { id: run.id }, data: { status, ...(status === "COMPLETED" ? { outcome: "PARTIAL" } : {}) } });
    expect((await publishScanJob(run.id)).dispatch).toBe("PUBLISHED");
    await withQueue(async queue => { expect(await queue.getJob(run.id)).toBeUndefined(); });
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).outcome).toBe(status === "COMPLETED" ? "PARTIAL" : null);
  });
  it("historical runs without an outbox remain readable and are not backfilled", async () => {
    const historical = await prisma.scanRun.create({ data: { targetId: owner.targetId, type: "RECON", status: "COMPLETED" } });
    const response = await GET(new NextRequest(`http://localhost/api/scan-runs?targetId=${owner.targetId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).find((run: { id: string }) => run.id === historical.id)).toMatchObject({ dispatch: null, outcome: null, status: "COMPLETED" });
    expect((await publishScanJob(historical.id)).dispatch).toBeNull();
    expect(await prisma.scanJobOutbox.count({ where: { scanRunId: historical.id } })).toBe(0);
  });
});
