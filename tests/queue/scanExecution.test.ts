import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { Queue, Worker } from "bullmq";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth }));
const exec = promisify(execFile);
const dbUrl = process.env.TEST_EXECUTION_DATABASE_URL, redisUrl = process.env.TEST_EXECUTION_REDIS_URL;
let prisma: typeof import("@/lib/prisma")["prisma"];
let cancel: typeof import("@/app/api/scan-runs/[id]/cancel/route")["POST"];
let maintain: typeof import("@/server/queue/executionMaintenance")["maintainScanExecutions"];
let begin: typeof import("@/server/queue/executionAttempts")["beginScanExecution"];
let server: Server, base: string, userId: string, targetId: string;
let redis: Redis, queue: Queue;
const queueName = `execution-test-${randomUUID()}`;
const children = new Set<ChildProcess>();
const requests: string[] = [], closed: string[] = [];
async function waitUntil(check: () => Promise<boolean> | boolean, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error("Controlled execution did not reach expected state");
}
async function spawnWorker(hold: boolean) {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/queue/executionWorker.mts"], { env: { ...process.env, DATABASE_URL: dbUrl, REDIS_URL: redisUrl, LOG_LEVEL: "silent", SCAN_TEST_TARGET: base, SCAN_TEST_QUEUE: queueName, SCAN_TEST_HOLD: hold ? "1" : "0" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  children.add(child);
  let error = ""; child.stderr!.on("data", chunk => { error += chunk.toString(); });
  child.stdout!.resume();
  let ready = false; child.on("message", message => { if (message === "ready") ready = true; });
  await waitUntil(() => { if (child.exitCode !== null) throw new Error(`Local worker exited: ${error}`); return ready; });
  return child;
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode) { children.delete(child); return; }
  const exit = once(child, "exit"); child.kill(signal); await exit; children.delete(child);
}
async function createRun() { return prisma.scanRun.create({ data: { targetId, type: "RECON" } }); }
async function enqueue(id: string) { return queue.add("scan", { scanRunId: id, targetId, type: "RECON" }, { jobId: id, attempts: 1 }); }
const requestCancel = (id: string) => cancel(new Request(`http://localhost/api/scan-runs/${id}/cancel`, { method: "POST" }), { params: Promise.resolve({ id }) });
describe.skipIf(!dbUrl || !redisUrl)("execution restart and cancellation with real PostgreSQL, Redis and local HTTP", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = dbUrl!;
    await exec("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: dbUrl }, timeout: 30000 });
    ({ prisma } = await import("@/lib/prisma"));
    ({ POST: cancel } = await import("@/app/api/scan-runs/[id]/cancel/route"));
    ({ maintainScanExecutions: maintain } = await import("@/server/queue/executionMaintenance"));
    ({ beginScanExecution: begin } = await import("@/server/queue/executionAttempts"));
    server = createServer((req, res) => {
      requests.push(req.url!); res.on("close", () => closed.push(req.url!));
      if (req.url === "/hold") { res.writeHead(200); res.write("incomplete response"); } else res.end("observed local response");
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    userId = (await prisma.user.create({ data: { email: `${randomUUID()}@execution.test` } })).id;
    const scope = await prisma.scope.create({ data: { userId, hostPattern: "127.0.0.1", status: "APPROVED" } });
    const program = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Local execution tests", requiredUserAgent: "ExecutionTest/1" } });
    targetId = (await prisma.target.create({ data: { userId, scopeId: scope.id, programId: program.id, host: new URL(base).host, scheme: "http" } })).id;
    auth.mockResolvedValue({ user: { id: userId } });
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: null }); redis.on("error", () => {});
    queue = new Queue(queueName, { connection: redis }); queue.on("error", () => {});
  }, 60000);
  afterAll(async () => {
    for (const child of children) await stop(child, "SIGKILL");
    if (queue) await queue.close(); redis?.disconnect();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    await prisma?.$disconnect();
  });
  it("PostgreSQL allows exactly one real attempt across concurrent worker identities", async () => {
    const run = await createRun();
    const claims = await Promise.all([begin(run.id, "worker-A"), begin(run.id, "worker-B")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await prisma.scanExecutionAttempt.count({ where: { scanRunId: run.id } })).toBe(1);
    await prisma.scanExecutionAttempt.updateMany({ where: { scanRunId: run.id }, data: { heartbeatAt: new Date(0) } }); await maintain();
  });
  it("a killed worker followed by a stalled BullMQ replay sends no second traffic", async () => {
    const run = await createRun(); const start = requests.length;
    await enqueue(run.id); const first = await spawnWorker(true);
    await waitUntil(() => requests.slice(start).includes("/hold"));
    await stop(first, "SIGKILL");
    const attempt = await prisma.scanExecutionAttempt.findFirstOrThrow({ where: { scanRunId: run.id } });
    expect(attempt.networkStartedAt).not.toBeNull(); expect(attempt.usefulWorkAt).not.toBeNull();
    // Simulate expiration of the documented 30s window, without sleeping 30s.
    await prisma.scanExecutionAttempt.update({ where: { id: attempt.id }, data: { heartbeatAt: new Date(Date.now() - 31000) } });
    const second = await spawnWorker(false);
    try {
      await waitUntil(async () => (await queue.getJob(run.id))?.attemptsStarted === 2);
      expect(requests.length).toBe(start + 2);
      expect(await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "FAILED", outcome: "PARTIAL", reconCorpus: { localObservation: true }, huntReport: { localObservation: true } });
      expect(await prisma.scanExecutionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ state: "INTERRUPTED", finishedAt: expect.any(Date) });
      expect(await prisma.scanExecutionAttempt.count({ where: { scanRunId: run.id } })).toBe(1);
      expect(await prisma.finding.findFirstOrThrow({ where: { scanRunId: run.id } })).toMatchObject({ reviewStatus: "CANDIDATE", gateStatus: "UNVALIDATED" });
      // A different, never-started job still executes normally after restart.
      const next = await createRun(); await enqueue(next.id);
      await waitUntil(async () => (await prisma.scanRun.findUniqueOrThrow({ where: { id: next.id } })).status === "COMPLETED");
      expect(requests.length).toBe(start + 3);
    } finally { await stop(second); }
  }, 20000);
  it("cancels an active owner through the durable API and closes the HTTP body before CANCELLED", async () => {
    const run = await createRun(), start = requests.length, closedStart = closed.length;
    await enqueue(run.id); const worker = await spawnWorker(true);
    try {
      await waitUntil(() => requests.slice(start).includes("/hold"));
      const before = await prisma.scanExecutionAttempt.findFirstOrThrow({ where: { scanRunId: run.id } });
      await waitUntil(async () => (await prisma.scanExecutionAttempt.findUniqueOrThrow({ where: { id: before.id } })).heartbeatAt > before.heartbeatAt);
      const response = await requestCancel(run.id); expect(response.status).toBe(202);
      expect((await response.json()).status).toBe("RUNNING");
      await waitUntil(async () => (await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).status === "CANCELLED");
      expect(closed.slice(closedStart)).toContain("/hold"); expect(requests.length).toBe(start + 2);
      expect(await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ outcome: null, cancelRequestedAt: expect.any(Date), reconCorpus: { localObservation: true } });
      expect(await prisma.scanExecutionAttempt.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ state: "CANCELLED", finishedAt: expect.any(Date) });
      expect((await requestCancel(run.id)).status).toBe(200);
    } finally { await stop(worker); }
  }, 20000);
  it("cancellation before start remains safe when a job is delivered late", async () => {
    const run = await createRun(), start = requests.length;
    expect((await requestCancel(run.id)).status).toBe(202); await maintain();
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELLED");
    await enqueue(run.id); const worker = await spawnWorker(false);
    try { await waitUntil(async () => (await queue.getJob(run.id))?.attemptsStarted === 1); expect(requests.length).toBe(start); expect(await prisma.scanExecutionAttempt.count({ where: { scanRunId: run.id } })).toBe(0); }
    finally { await stop(worker); }
  });
  it("SIGTERM stops active traffic and records INTERRUPTED rather than SUCCESS or CANCELLED", async () => {
    const run = await createRun(), start = requests.length;
    await enqueue(run.id); const worker = await spawnWorker(true);
    await waitUntil(() => requests.slice(start).includes("/hold")); await stop(worker);
    expect(await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "FAILED", outcome: "PARTIAL", finishedAt: expect.any(Date) });
    expect(await prisma.scanExecutionAttempt.findFirstOrThrow({ where: { scanRunId: run.id } })).toMatchObject({ state: "INTERRUPTED", reason: "WORKER_SHUTDOWN" });
    expect(requests.length).toBe(start + 2);
  }, 15000);
  it("rejects foreign cancellation and returns a conflict for a completed run", async () => {
    const run = await createRun(); auth.mockResolvedValue({ user: { id: "foreign" } });
    expect((await requestCancel(run.id)).status).toBe(404); auth.mockResolvedValue({ user: { id: userId } });
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).cancelRequestedAt).toBeNull();
    await prisma.scanRun.update({ where: { id: run.id }, data: { status: "COMPLETED", outcome: "SUCCESS" } });
    expect((await requestCancel(run.id)).status).toBe(409);
  });
  it("a job acquired during shutdown remains waiting and executes once after restart", async () => {
    const { createScanProcessor } = await import("@/server/queue/processScan");
    const processor = createScanProcessor("closing-worker"); processor.stopAccepting();
    const run = await createRun(), start = requests.length;
    const worker = new Worker(queueName, (job, token, signal) => { void worker.pause(true); return processor.process(job, signal, token); }, { connection: redis, autorun: false });
    worker.on("error", () => {}); await enqueue(run.id); void worker.run();
    try { await waitUntil(async () => { const job = await queue.getJob(run.id); return job?.attemptsStarted === 1 && await job.getState() === "waiting"; }); }
    finally { await worker.close(true); }
    expect(await prisma.scanExecutionAttempt.count({ where: { scanRunId: run.id } })).toBe(0);
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("QUEUED");
    const replacement = await spawnWorker(false);
    try { await waitUntil(async () => (await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).status === "COMPLETED"); expect(requests.length).toBe(start + 1); }
    finally { await stop(replacement); }
  });

});
