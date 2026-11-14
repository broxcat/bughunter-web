import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { launchIsolatedBrowser } from '@/server/isolatedBrowser';
import { admitPdfExport, PDF_LEASE_KEY } from '@/server/recon/pdfExportGate';
import { ScanControl, withScanControl } from '@/server/scanControl';

const exec = promisify(execFile);
const suite = process.env.TEST_AUDIT === '1' ? describe : describe.skip;
suite('disposable Linux security acceptance', () => {
  const url = process.env.TEST_AUDIT_UPGRADE_URL!;
  let db: PrismaClient, redis: Redis, directory: string;
  const email = 'existing-user@fixture.test', password = 'disposable-password-123';
  beforeAll(async () => {
    expect(url).toContain('@audit-pg:5432/upgrade');
    directory = await mkdtemp(join(tmpdir(), 'audit-upgrade-'));
    await mkdir(join(directory, 'migrations'));
    const schema = (await readFile('prisma/schema.prisma', 'utf8')).replace(/^\s*sessionVersion\s+Int.*$/m, '');
    await writeFile(join(directory, 'schema.prisma'), schema);
    for (const name of await readdir('prisma/migrations')) if (name < '20261114120000' || name === 'migration_lock.toml') await cp(join('prisma/migrations', name), join(directory, 'migrations', name), { recursive: true });
    await exec('npx', ['prisma', 'migrate', 'deploy', '--schema', join(directory, 'schema.prisma')], { env: { ...process.env, DATABASE_URL: url } });
    db = new PrismaClient({ datasourceUrl: url });
    const hash = await bcrypt.hash(password, 4);
    await db.$executeRaw`INSERT INTO "User" (id,email,"passwordHash","createdAt","updatedAt") VALUES ('existing-user',${email},${hash},now(),now())`;
    await exec('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url } });
    redis = new Redis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: 0 });
    redis.on('error', () => {});
  }, 120000);
  afterAll(async () => { await db?.$disconnect(); redis?.disconnect(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it('upgrades existing data and verifies real login, revocation, password change and deletion', async () => {
    expect(await db.user.findUniqueOrThrow({ where: { id: 'existing-user' } })).toMatchObject({ email, sessionVersion: 0 });
    process.env.DATABASE_URL = url;
    process.env.AUTH_URL = 'http://auth.fixture.test';
    const { handlers } = await import('@/lib/auth');
    const jar = new Map<string, string>();
    const invoke = async (method: 'GET' | 'POST', path: string, body?: URLSearchParams) => {
      const response = await handlers[method](new NextRequest('http://auth.fixture.test/api/auth/' + path, { method, headers: { cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body }));
      for (const cookie of response.headers.getSetCookie()) { const first = cookie.split(';')[0], at = first.indexOf('='); jar.set(first.slice(0, at), first.slice(at + 1)); }
      return response;
    };
    const login = async (secret = password) => {
      const csrf = await (await invoke('GET', 'csrf')).json();
      await invoke('POST', 'callback/credentials', new URLSearchParams({ csrfToken: csrf.csrfToken, email, password: secret }));
      return (await invoke('GET', 'session')).json();
    };
    expect((await login()).user.id).toBe('existing-user');
    await exec(process.execPath, ['scripts/revoke-sessions.mjs', email], { env: { ...process.env, DATABASE_URL: url } });
    expect(await (await invoke('GET', 'session')).json()).toBeNull();
    expect((await login()).user.id).toBe('existing-user');
    const changed = 'changed-fixture-password';
    await db.user.update({ where: { id: 'existing-user' }, data: { passwordHash: await bcrypt.hash(changed, 4) } });
    expect((await db.user.findUniqueOrThrow({ where: { id: 'existing-user' } })).sessionVersion).toBe(2);
    expect(await (await invoke('GET', 'session')).json()).toBeNull();
    expect((await login(changed)).user.id).toBe('existing-user');
    await db.user.delete({ where: { id: 'existing-user' } });
    expect(await (await invoke('GET', 'session')).json()).toBeNull();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  });

  it('authenticates Redis and executes a real BullMQ job', async () => {
    expect(await redis.ping()).toBe('PONG');
    const connection = new Redis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: null });
    const name = 'audit-' + randomUUID();
    const queue = new Queue(name, { connection }), events = new QueueEvents(name, { connection });
    const worker = new Worker(name, async job => job.data.value + 1, { connection });
    try { await events.waitUntilReady(); const job = await queue.add('fixture', { value: 41 }); expect(await job.waitUntilFinished(events, 5000)).toBe(42); }
    finally { await worker.close(); await events.close(); await queue.obliterate({ force: true }); await queue.close(); connection.disconnect(); }
  });

  it('shares PDF capacity across independent Node processes and quarantines a crashed owner', async () => {
    await redis.del(PDF_LEASE_KEY);
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/security/pdfLeaseChild.mts', 'hold'], { env: { ...process.env, REDIS_URL: process.env.TEST_REDIS_URL }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const admission = await new Promise<{ admitted: boolean; owner: string }>((resolve, reject) => {
      child.stdout.on('data', data => { output += data; if (output.includes('\n')) { try { resolve(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); } } });
      child.once('error', reject); child.once('exit', code => { if (!output) reject(new Error('Lease child exited ' + code)); });
    });
    try {
      expect(admission.admitted).toBe(true);
      const second = await exec(process.execPath, ['--import', 'tsx', 'tests/security/pdfLeaseChild.mts'], { env: { ...process.env, REDIS_URL: process.env.TEST_REDIS_URL } });
      expect(JSON.parse(second.stdout)).toMatchObject({ admitted: false, reason: 'BUSY' });
      // A renderer may outlive its client: expiration alone must not recycle it.
      const owner = await redis.hget(PDF_LEASE_KEY, admission.owner);
      expect(JSON.parse(owner!).expiresAt).toBeGreaterThan(Date.now());
      // Expiration does not silently return an unconfirmed renderer's slot.
      await redis.hset(PDF_LEASE_KEY, admission.owner, JSON.stringify({ ...JSON.parse(owner!), expiresAt: Date.now() - 1 }));
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
      const third = await exec(process.execPath, ['--import', 'tsx', 'tests/security/pdfLeaseChild.mts'], { env: { ...process.env, REDIS_URL: process.env.TEST_REDIS_URL } });
      expect(JSON.parse(third.stdout)).toMatchObject({ admitted: false, reason: 'BUSY' });
      // Fixture used no renderer, so teardown can prove safe cleanup.
    } finally { child.kill('SIGKILL'); await redis.del(PDF_LEASE_KEY); }
  });

  it('fails closed when its Redis endpoint is unavailable', async () => {
    const result = await exec(process.execPath, ['--import', 'tsx', 'tests/security/pdfLeaseChild.mts'], { env: { ...process.env, REDIS_URL: 'redis://:fixture@127.0.0.1:1' } });
    expect(JSON.parse(result.stdout)).toMatchObject({ admitted: false, reason: 'UNAVAILABLE' });
  });

  it('runs Chromium sandboxed, and kills a blocked renderer before close returns', async () => {
    await redis.del(PDF_LEASE_KEY);
    const admission = await admitPdfExport('blocked-renderer');
    expect(admission.admitted).toBe(true);
    if (!admission.admitted) throw new Error('Capacity unavailable');
    const browser = await launchIsolatedBrowser();
    try {
      const page = await browser.newPage();
      await page.goto('chrome://sandbox');
      const status = await page.locator('body').innerText();
      expect(status).toMatch(/Layer 1 Sandbox\s+Namespace/i);
      expect(status).toMatch(/PID namespaces\s+Yes/i);
      expect(status).toMatch(/Network namespaces\s+Yes/i);
      expect(status).toMatch(/Seccomp-BPF sandbox\s+Yes/i);
      const blocked = page.evaluate(() => { for (;;) { /* hostile engine */ } }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 200));
      const busy = await exec(process.execPath, ['--import', 'tsx', 'tests/security/pdfLeaseChild.mts'], { env: { ...process.env, REDIS_URL: process.env.TEST_REDIS_URL } });
      expect(JSON.parse(busy.stdout)).toMatchObject({ admitted: false, reason: 'BUSY' });
      const start = Date.now(); await browser.close();
      expect(Date.now() - start).toBeLessThan(5000);
      await blocked;
      await admission.release();
      const free = await exec(process.execPath, ['--import', 'tsx', 'tests/security/pdfLeaseChild.mts'], { env: { ...process.env, REDIS_URL: process.env.TEST_REDIS_URL } });
      expect(JSON.parse(free.stdout)).toMatchObject({ admitted: true });
    } finally { await browser.close(); await admission.release(); }
  }, 30000);
  it('cancels and drains an actual hostile browser with a blocked renderer', async () => {
    const { launchTargetBrowser, newTargetBrowserContext, withTargetExecution } = await import('@/server/execution');
    const control = new ScanControl({ scanRunId: 'fixture-run', attemptId: 'fixture-attempt', workerId: 'fixture-worker' }, async () => {});
    await withScanControl(control, () => withTargetExecution({ targetId: 'fixture', host: 'fixture.test', requiredUserAgent: 'Audit/1', qualifying: [], nonQualifying: [] }, async () => {
      const browser = await launchTargetBrowser({ headless: true });
      const context = await newTargetBrowserContext(browser), page = await context.newPage();
      const blocked = page.evaluate(() => { for (;;) { /* hostile target */ } }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 100));
      control.abort('USER_CANCELLED');
      const start = Date.now();
      expect(await control.cleanup()).toBe(true);
      expect(Date.now() - start).toBeLessThan(5000);
      await blocked;
    }));
  }, 30000);
});
