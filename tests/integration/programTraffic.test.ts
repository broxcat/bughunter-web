
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

const worker = `
const { acquireProgramTraffic, releaseProgramTraffic } = require('./src/server/programTraffic.ts');
const { setTimeout: delay } = require('node:timers/promises');
process.send('ready');
process.on('message', async ({ programId, limits, hold }) => {
  try {
    const lease = await acquireProgramTraffic(programId, limits, AbortSignal.timeout(5000));
    const start = Date.now();
    await delay(hold);
    const end = Date.now();
    await releaseProgramTraffic(programId, lease);
    process.send({ start, end }, () => process.exit(0));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});`;

async function overlap(limits: { requestsPerSecond: number; maxConcurrency: number }, hold: number) {
  const children = Array.from({ length: 2 }, () => spawn(process.execPath, ['--import', 'tsx', '-e', worker], {
    env: { ...process.env, REDIS_URL: process.env.TEST_EXECUTION_REDIS_URL },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  }));
  const receive = async (child: typeof children[number]) => Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw new Error(`Traffic worker exited (${code})`); }),
  ]);
  try {
    await Promise.all(children.map(receive));
    const results = Promise.all(children.map(receive));
    const programId = randomUUID();
    for (const child of children) child.send({ programId, limits, hold });
    return (await results as { start: number; end: number }[]).sort((a, b) => a.start - b.start);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
  }
}

describe.skipIf(!process.env.TEST_EXECUTION_REDIS_URL)('program traffic across independent workers', () => {
  it('shares one token bucket even when both workers can hold a concurrent slot', async () => {
    const [first, second] = await overlap({ requestsPerSecond: 4, maxConcurrency: 2 }, 10);
    expect(second.start - first.start).toBeGreaterThanOrEqual(235);
  }, 15_000);

  it('does not grant a second in-flight slot before the first releases it', async () => {
    const [first, second] = await overlap({ requestsPerSecond: 100, maxConcurrency: 1 }, 180);
    expect(second.start).toBeGreaterThanOrEqual(first.end);
  }, 15_000);
});
