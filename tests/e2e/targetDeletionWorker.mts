// Real heartbeat/cleanup lifecycle, with work held locally until cancellation.
import { prisma } from '../../src/lib/prisma';
import { createScanProcessor } from '../../src/server/queue/processScan';
import { currentScanControl } from '../../src/server/scanControl';
import type { Job } from 'bullmq';
import type { ScanJobData } from '../../src/server/queue/scanQueue';
const data = JSON.parse(process.env.DELETION_TEST_JOB!) as ScanJobData;
const processor = createScanProcessor('deletion-browser-worker', async () => {
  const control = currentScanControl()!;
  control.track(async () => { process.send?.('cleaned'); });
  process.send?.('started');
  await new Promise<void>((_, reject) => control.signal.addEventListener('abort', () => reject(control.signal.reason), { once: true }));
  return { outcome: 'SUCCESS' };
});
try {
  await processor.process({ data, attemptsStarted: 1 } as Job<ScanJobData>);
  process.send?.('stopped');
} finally { await prisma.$disconnect(); }
