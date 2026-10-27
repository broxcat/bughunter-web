// Child process used only by disposable infrastructure tests. It runs the real
// processor/attempt/heartbeat code, with a scanner confined to local HTTP.
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "../../src/lib/prisma";
import { createScanProcessor } from "../../src/server/queue/processScan";
import { maintainScanExecutions } from "../../src/server/queue/executionMaintenance";
import { probe } from "../../src/server/scanners/http";
import type { ScanJobData } from "../../src/server/queue/scanQueue";
const base = process.env.SCAN_TEST_TARGET!, queueName = process.env.SCAN_TEST_QUEUE!;
if (new URL(base).hostname !== "127.0.0.1" || !queueName.startsWith("execution-test-") || new URL(process.env.DATABASE_URL!).pathname !== "/execution_test") throw new Error("Disposable local test configuration required");
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }); connection.on("error", () => {});
const processor = createScanProcessor(`test-worker-${process.pid}`, async (_type, _host, scanRunId) => {
  await probe(`${base}/first`);
  await prisma.scanRun.update({ where: { id: scanRunId }, data: { reconCorpus: { localObservation: true }, huntReport: { localObservation: true } } });
  await prisma.finding.create({ data: { targetId: (await prisma.scanRun.findUniqueOrThrow({ where: { id: scanRunId } })).targetId, scanRunId, title: "Controlled local observation", reviewStatus: "CANDIDATE" } });
  if (process.env.SCAN_TEST_HOLD === "1") await probe(`${base}/hold`, { timeoutMs: 60000 });
  return { outcome: "SUCCESS" };
});
await maintainScanExecutions();
const worker = new Worker<ScanJobData>(queueName, (job, token, signal) => processor.process(job, signal, token), { connection, concurrency: 1, maxStalledCount: 1, lockDuration: 1000, stalledInterval: 250 });
worker.on("error", () => {});
await worker.waitUntilReady(); process.send?.("ready");
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  processor.stopAccepting(); void worker.pause(true);
  await processor.shutdown(); await worker.close(true); connection.disconnect(); await prisma.$disconnect(); process.exit(0);
}
process.on("SIGTERM", () => void shutdown()); process.on("SIGINT", () => void shutdown());
