import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, lstat, readdir, rm, readFile, writeFile, symlink, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withPublicationTestHooks, type PublicationPhase } from '@/server/research/publicationTestHooks';
const database = process.env.TEST_DATABASE_URL, schema = 'provision_' + randomUUID().replaceAll('-', '');
if (database) { const url = new URL(database); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString(); }
let p: typeof import('@/lib/prisma').prisma;
let ensure: typeof import('@/server/research/consoleWorkspace').ensureTargetConsole;
let root: string;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const exists = (path: string) => lstat(path).then(() => true, () => false);
async function interruptedProcess(f: Awaited<ReturnType<typeof fixture>>, phase: PublicationPhase, layout = 'console') {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/research/publicationProcess.mts', f.owner.id, f.target.id, phase, layout], { env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let error = ''; child.stderr?.on('data', data => error += data);
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Process fixture did not reach phase: ' + error.slice(-1000))); }, 60000); child.once('message', () => { clearTimeout(timer); resolve(); }); child.once('exit', code => { clearTimeout(timer); if (code !== null) reject(Error('Process fixture exited: ' + error.slice(-1000))); }); });
  const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exit;
}
async function fixture() {
  const owner = await p.user.create({ data: { email: randomUUID() + '@example.test' } });
  const program = await p.bountyProgram.create({ data: { ownerId: owner.id, companyName: 'Provisioning fixture', requiredUserAgent: 'Provision/1' } });
  const scope = await p.scope.create({ data: { userId: owner.id, hostPattern: 'fixture.test', status: 'APPROVED' } });
  const target = await p.target.create({ data: { userId: owner.id, programId: program.id, scopeId: scope.id, host: 'fixture.test' } });
  return { owner, program, scope, target, path: join(root, 'research_' + target.id) };
}
(database ? describe : describe.skip)('recoverable Research publication (real SQL/filesystem; injected failures)', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma')); ({ ensureTargetConsole: ensure } = await import('@/server/research/consoleWorkspace'));
    root = await mkdtemp(join(tmpdir(), 'bh-issue8-publication-')); process.env.RESEARCH_CONSOLE_ROOT = root; process.env.RESEARCH_WORKSPACE_ROOT = root;
  }, 120000);
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } if (root) await rm(root, { recursive: true, force: true }); });

  it('survives slow durable writes exceeding the old 15s deadline without an open DB transaction', async () => {
    // Always exercise actual disk here; the other injected crash windows honor
    // TMPDIR so a full run does not needlessly saturate Docker's backing disk.
    const disk = await mkdtemp('/tmp/bh-issue8-slow-disk-');
    process.env.RESEARCH_CONSOLE_ROOT = disk;
    try {
    const f = await fixture(), durations: number[] = []; let began = 0, once = false, ioStart = 0, ioEnd = 0, activationStart = 0, activationEnd = 0, inSql = false;
    const start = performance.now();
    const result = await withPublicationTestHooks({
      SQL_BEGIN: async () => { inSql = true; began = performance.now(); }, SQL_END: async () => { inSql = false; durations.push(performance.now() - began); },
      PUBLICATION_BEGIN: async () => { expect(inSql).toBe(false); ioStart = performance.now(); },
      FILE_DURABLE: async () => { if (!once) { once = true; await delay(16100); } },
      AFTER_RENAME: async () => { ioEnd = performance.now(); },
      ACTIVATION_BEGIN: async () => { expect(inSql).toBe(false); activationStart = performance.now(); },
      AFTER_ACTIVATION: async () => { activationEnd = performance.now(); },
    }, () => ensure(f.owner.id, f.target.id));
    const metrics = { databaseTransactionMs: durations.map(Math.round), filesystemPublicationMs: Math.round(ioEnd - ioStart), filesystemActivationMs: Math.round(activationEnd - activationStart), totalMs: Math.round(performance.now() - start) };
    console.log('ISSUE8_SLOW_IO', JSON.stringify(metrics));
    if (process.env.ISSUE8_METRICS_FILE) await writeFile(process.env.ISSUE8_METRICS_FILE, JSON.stringify(metrics));
    expect(result.session.status).toBe('READY'); expect(durations).toHaveLength(3); expect(Math.max(...durations)).toBeLessThan(5000); expect(metrics.filesystemPublicationMs).toBeGreaterThan(16000);
    expect(await exists(join(disk, result.session.workspaceId, 'scope.md'))).toBe(true);
    } finally { process.env.RESEARCH_CONSOLE_ROOT = root; await rm(disk, { recursive: true, force: true }); }
  }, 120000);


  it('retains a recoverable reservation on an injected timeout before rename after 16s of publication', async () => {
    const f = await fixture();
    await expect(withPublicationTestHooks({ BEFORE_RENAME: async () => { await delay(16100); throw Error('Injected publication deadline'); } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    expect(await exists(f.path)).toBe(false);
    expect((await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } })).status).toBe('CREATING');
    expect((await ensure(f.owner.id, f.target.id)).session.status).toBe('READY');
  }, 120000);
  it('resumes a committed reservation interrupted before its manifest or files were written', async () => {
    const f = await fixture();
    await expect(withPublicationTestHooks({ SQL_END: async () => { throw Error('Interrupted after reservation commit'); } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    const pending = await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } });
    expect(pending.status).toBe('CREATING'); expect(pending.publicationManifest).toBeNull();
    expect(await exists(f.path)).toBe(false);
    const recovered = await ensure(f.owner.id, f.target.id);
    expect(recovered.session.id).toBe(pending.id); expect(recovered.session.status).toBe('READY');
  });
  it('keeps a renamed candidate unreadable to the Research group until READY commits', async () => {
    const f = await fixture();
    const drop = ['--reuid=65534', `--regid=${process.getgid!()}`, '--clear-groups', '--'];
    let localReader = process.getuid!() === 0 ? { command: '/usr/bin/setpriv', args: drop } : null;
    if (!localReader) try {
      const args = ['-n', '/usr/bin/setpriv', ...drop];
      if (execFileSync('/usr/bin/sudo', [...args, '/usr/bin/id', '-u'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, killSignal: 'SIGKILL' }).toString().trim() === '65534') localReader = { command: '/usr/bin/sudo', args };
    } catch { /* No local privilege-drop route: require the Docker identity below. */ }
    const readable = () => {
      // A separate unprivileged OS identity shares only the Research group.
      try {
        if (localReader) execFileSync(localReader.command, [...localReader.args, '/usr/bin/test', '-r', join(f.path, 'scope.md')], { stdio: 'pipe', timeout: 2000, killSignal: 'SIGKILL' });
        else execFileSync('docker', ['run', '--rm', '--network', 'none', '--label', 'bughunter.issue8=disposable', '--user', `65534:${process.getgid!()}`, '--mount', `type=bind,source=${root},target=/candidates,readonly`, '--entrypoint', 'sh', 'postgres:16-alpine', '-c', 'test -r "$1/scope.md"', 'fixture', '/candidates/research_' + f.target.id], { stdio: 'pipe', timeout: 30000, killSignal: 'SIGKILL' });
        return true;
      } catch (error) { if ((error as {status?: number}).status === 1) return false; throw error; }
    };
    let beforeReady: boolean | undefined;
    await withPublicationTestHooks({ AFTER_RENAME: async () => {
      expect((await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } })).status).toBe('CREATING');
      beforeReady = readable();
    } }, () => ensure(f.owner.id, f.target.id));
    expect(beforeReady).toBe(false); expect(readable()).toBe(true);
  }, 120000);
  it('serializes two actual processes while durable publication is in progress', async () => {
    const f = await fixture(); let childResult: Promise<string> | undefined, once = false;
    const first = await withPublicationTestHooks({ FILE_DURABLE: async () => {
      if (once) return; once = true;
      const child = spawn(process.execPath, ['--import', 'tsx', 'tests/research/publicationProcess.mts', f.owner.id, f.target.id, 'NONE', 'console'], { env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      childResult = new Promise<string>((resolve, reject) => { const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Concurrent child timeout')); }, 60000); child.once('message', message => { clearTimeout(timer); resolve((message as {sessionId:string}).sessionId); }); child.once('error', reject); });
      await delay(1000);
    } }, () => ensure(f.owner.id, f.target.id));
    expect(await childResult).toBe(first.session.id);
    expect(await p.researchSession.count({ where: { consoleTargetId: f.target.id } })).toBe(1);
  }, 120000);
  it('does not replace an unexpected empty final directory inserted immediately before rename', async () => {
    const f = await fixture(); let inode = 0;
    await expect(withPublicationTestHooks({ BEFORE_RENAME: async () => { await mkdir(f.path); inode = (await lstat(f.path)).ino; } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    expect((await lstat(f.path)).ino).toBe(inode); expect(await readdir(f.path)).toEqual([]);
    expect((await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } })).status).toBe('CREATING');
    await expect(ensure(f.owner.id, f.target.id)).rejects.toThrow(/Incomplete|Unsafe/);
  });
  it('cleans its own temporary tree on interruption before rename, retaining a retryable reservation', async () => {
    const f = await fixture();
    await expect(withPublicationTestHooks({ BEFORE_RENAME: async () => { throw Error('Injected before rename'); } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    expect(await exists(f.path)).toBe(false);
    expect((await readdir(root)).filter(n => n.startsWith('.tmp-research_' + f.target.id))).toEqual([]);
    expect((await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } })).status).toBe('CREATING');
    expect((await ensure(f.owner.id, f.target.id)).session.status).toBe('READY');
  });
  it.each(['AFTER_RENAME', 'BEFORE_READY', 'READY_IN_TRANSACTION'] as const)('recovers a complete published workspace after %s failure without rewriting it', async phase => {
    const f = await fixture();
    await expect(withPublicationTestHooks({ [phase]: async () => { throw Error('Injected interruption'); } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    const pending = await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } });
    expect(pending.status).toBe('CREATING'); expect(await exists(f.path)).toBe(true);
    const before = await lstat(join(f.path, 'scope.md')), bytes = await readFile(join(f.path, 'scope.md'));
    const retry = await ensure(f.owner.id, f.target.id);
    expect(retry.session.id).toBe(pending.id); expect(retry.session.status).toBe('READY');
    expect((await lstat(join(f.path, 'scope.md'))).ino).toBe(before.ino); expect(await readFile(join(f.path, 'scope.md'))).toEqual(bytes);
  });
  it.each(['FILE_DURABLE', 'BEFORE_RENAME', 'AFTER_RENAME', 'AFTER_READY', 'AFTER_ACTIVATION'] as const)('releases a dead process lock and retries safely after %s', async phase => {
    const f = await fixture(); await interruptedProcess(f, phase);
    const prior = await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } });
    expect(prior.status).toBe(['AFTER_READY', 'AFTER_ACTIVATION'].includes(phase) ? 'READY' : 'CREATING');
    if (['AFTER_RENAME', 'AFTER_READY'].includes(phase)) expect((await lstat(f.path)).mode & 0o7777).toBe(0o2700);
    const retry = await ensure(f.owner.id, f.target.id);
    expect(retry.session.id).toBe(prior.id); expect(retry.session.status).toBe('READY');
    expect((await lstat(f.path)).mode & 0o7777).toBe(0o2750);
    expect((await readdir(root)).filter(n => n.startsWith('.tmp-research_' + f.target.id))).toEqual([]);
  }, 120000);
  it('serializes two callers and two concurrent orphan retries into one authoritative workspace', async () => {
    const pair = async (f: Awaited<ReturnType<typeof fixture>>) => {
      const attempts = await Promise.allSettled([ensure(f.owner.id, f.target.id), ensure(f.owner.id, f.target.id)]);
      const ready = attempts.filter(a => a.status === 'fulfilled');
      expect(ready.length).toBeGreaterThan(0);
      for (const attempt of attempts) if (attempt.status === 'rejected') {
        expect(attempt.reason).toMatchObject({ status: 409 });
        expect(attempt.reason.message).toMatch(/publication is busy or unavailable/);
      }
      // A bounded loser may return busy while the slow owner completes. Retry
      // only after both attempts settle, then require the same authoritative ID.
      const retries = await Promise.all(attempts.map(a => a.status === 'fulfilled' ? a.value : ensure(f.owner.id, f.target.id)));
      expect(retries[0].session.id).toBe(retries[1].session.id);
      for (const result of ready) if (result.status === 'fulfilled') expect(result.value.session.id).toBe(retries[0].session.id);
      return retries;
    };
    const f = await fixture();
    const first = await pair(f);
    expect(first[0].session.id).toBe(first[1].session.id);
    const second = await fixture(); await interruptedProcess(second, 'AFTER_RENAME');
    const recovered = await pair(second);
    expect(recovered[0].session.id).toBe(recovered[1].session.id);
    expect(await p.researchSession.count({ where: { consoleTargetId: second.target.id, status: 'READY' } })).toBe(1);
  }, 120000);
  it('returns bounded busy while another attempt owns publication, then retries without deleting its staging files', async () => {
    const f = await fixture(); let entered!: () => void, release!: () => void, once = false;
    const held = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
    const owner = withPublicationTestHooks({ FILE_DURABLE: async () => {
      if (once) return; once = true; entered(); await gate;
    } }, () => ensure(f.owner.id, f.target.id));
    try {
      await Promise.race([held, owner.then(() => { throw Error('Owner did not enter publication'); })]);
      const began = performance.now();
      await expect(ensure(f.owner.id, f.target.id)).rejects.toMatchObject({ status: 409, message: 'Workspace publication is busy or unavailable' });
      expect(performance.now() - began).toBeGreaterThan(28000);
    } finally { release(); }
    const ready = await owner;
    expect((await ensure(f.owner.id, f.target.id)).session.id).toBe(ready.session.id);
    expect(await p.researchSession.count({ where: { consoleTargetId: f.target.id, status: 'READY' } })).toBe(1);
  }, 120000);

  it.each(['BEFORE_RENAME', 'AFTER_RENAME'] as const)('keeps Recon snapshot metadata consistent on recovery after %s', async phase => {
    const f = await fixture();
    await expect(withPublicationTestHooks({ [phase]: async () => { throw Error('Interrupted publication'); } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    const { researchRecon } = await import('../fixtures/research');
    const recon = await p.scanRun.create({ data: { targetId: f.target.id, type: 'RECON', status: 'COMPLETED', outcome: 'SUCCESS', reconCorpus: researchRecon()!.reconCorpus as never } });
    const ready = await ensure(f.owner.id, f.target.id);
    const captured = JSON.parse(await readFile(join(f.path, '.agents/bughunter/session.json'), 'utf8'));
    expect(captured.reconScanRunId).toBe(phase === 'BEFORE_RENAME' ? recon.id : null);
    expect(ready.session.reconScanRunId).toBe(captured.reconScanRunId);
  }, 120000);
  it('never deletes or overwrites a valid persistent workspace when reconnect fails', async () => {
    const f = await fixture(), first = await ensure(f.owner.id, f.target.id);
    await writeFile(join(f.path, 'findings/notes.md'), 'Preserved operator evidence');
    const scope = await readFile(join(f.path, 'scope.md'));
    await expect(withPublicationTestHooks({ BEFORE_READY: async () => { throw Error('Injected reconnect failure'); } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    expect(await readFile(join(f.path, 'findings/notes.md'), 'utf8')).toBe('Preserved operator evidence');
    expect(await readFile(join(f.path, 'scope.md'))).toEqual(scope);
    expect((await p.researchSession.findUniqueOrThrow({ where: { id: first.session.id } })).status).toBe('READY');
  });
  it.each(['revoke', 'drift', 'boundary'] as const)('rejects %s during publication and rejects the orphan on retry', async change => {
    const f = await fixture();
    await expect(withPublicationTestHooks({ AFTER_RENAME: async () => {
      if (change === 'revoke') await p.scope.update({ where: { id: f.scope.id }, data: { status: 'REVOKED' } });
      else if (change === 'drift') await p.bountyProgram.update({ where: { id: f.program.id }, data: { requiredUserAgent: 'Changed-UA' } });
      else await p.target.update({ where: { id: f.target.id }, data: { active: false } });
    } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    expect((await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } })).status).toBe('CREATING');
    await expect(ensure(f.owner.id, f.target.id)).rejects.toThrow();
    expect(await exists(f.path)).toBe(true);
    expect((await lstat(f.path)).mode & 0o7777).toBe(0o2700);
  });
  it('refuses terminal admission if policy is revoked during post-commit filesystem activation', async () => {
    const f = await fixture();
    await expect(withPublicationTestHooks({ ACTIVATION_BEGIN: async () => {
      await p.scope.update({ where: { id: f.scope.id }, data: { status: 'REVOKED' } });
    } }, () => ensure(f.owner.id, f.target.id))).rejects.toThrow();
    // This was authorized at READY commit, like other historical snapshots;
    // revocation still prevents this response and every subsequent open.
    expect((await p.researchSession.findUniqueOrThrow({ where: { consoleTargetId: f.target.id } })).status).toBe('READY');
    await expect(ensure(f.owner.id, f.target.id)).rejects.toThrow();
  });
  it('fails closed on hostile final contents, permissions and symlinks without deleting them', async () => {
    const f = await fixture(); await mkdir(f.path); await writeFile(join(f.path, 'sentinel'), 'Do not delete');
    await expect(ensure(f.owner.id, f.target.id)).rejects.toThrow(/Unknown existing/);
    expect(await readFile(join(f.path, 'sentinel'), 'utf8')).toBe('Do not delete');
    expect(await p.researchSession.count({ where: { consoleTargetId: f.target.id } })).toBe(0);
    const g = await fixture(); await interruptedProcess(g, 'AFTER_RENAME');
    await chmod(join(g.path, 'scope.md'), 0o660);
    await expect(ensure(g.owner.id, g.target.id)).rejects.toThrow(/integrity/);
    const h = await fixture(); await symlink(g.path, h.path);
    await expect(ensure(h.owner.id, h.target.id)).rejects.toThrow(); expect((await lstat(h.path)).isSymbolicLink()).toBe(true);
  }, 120000);
  it('recovers interrupted legacy exports without touching another historical workspace', async () => {
    const { createResearchSession, resumeResearchSession } = await import('@/server/research/sessions');
    const f = await fixture(), historical = await createResearchSession(f.owner.id, f.target.id);
    const oldBytes = await readFile(join(root, historical.workspaceId, 'scope.md'));
    await interruptedProcess(f, 'AFTER_RENAME', 'legacy');
    const pending = await p.researchSession.findFirstOrThrow({ where: { targetId: f.target.id, status: 'CREATING' } });
    const recovered = await resumeResearchSession(f.owner.id, pending.id);
    expect(recovered.id).toBe(pending.id); expect(recovered.status).toBe('READY');
    expect(await readFile(join(root, historical.workspaceId, 'scope.md'))).toEqual(oldBytes);
    const second = await fixture();
    await expect(withPublicationTestHooks({ BEFORE_RENAME: async () => { throw Error('Interrupted legacy write'); } }, () => createResearchSession(second.owner.id, second.target.id))).rejects.toThrow();
    const temp = await p.researchSession.findFirstOrThrow({ where: { targetId: second.target.id } });
    expect(temp.status).toBe('CREATING'); expect(await exists(join(root, temp.workspaceId))).toBe(false);
    expect((await resumeResearchSession(second.owner.id, temp.id)).status).toBe('READY');
    const third = await fixture(); await interruptedProcess(third, 'FILE_DURABLE', 'legacy');
    const interrupted = await p.researchSession.findFirstOrThrow({ where: { targetId: third.target.id } });
    const unknownArchive = join(root, '.exports', interrupted.workspaceId + '.zip');
    await writeFile(unknownArchive, 'Unrecognized archive: preserve me', { mode: 0o600 });
    await expect(resumeResearchSession(third.owner.id, interrupted.id)).rejects.toThrow(/Unexpected publication archive/);
    expect(await readFile(unknownArchive, 'utf8')).toBe('Unrecognized archive: preserve me');
    expect((await p.researchSession.findUniqueOrThrow({ where: { id: interrupted.id } })).status).toBe('CREATING');
  }, 120000);
});
