import { readdir, readlink, readFile, rm, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claudeConfigDirectory } from '../validator/claude-config.mjs';
import { codexRead } from '../validator/codex-rpc.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Snapshot /proc, include descendants even when a child changed directory. Only
// researcher processes can be signalled by the unprivileged terminal service.
export async function workspaceProcesses(paths) {
  const all = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const status = await readFile(`/proc/${name}/status`, 'utf8');
      if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== process.getuid()) continue;
      const cwd = await readlink(`/proc/${name}/cwd`).catch(() => '');
      all.push({ pid: Number(name), ppid: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]), selected: paths.some(p => cwd === p || cwd.startsWith(p + '/')) });
    } catch { /* Process exited. */ }
  }
  const ids = new Set(all.filter(p => p.selected).map(p => p.pid));
  for (let previous = -1; previous !== ids.size;) { previous = ids.size; for (const p of all) if (ids.has(p.ppid)) ids.add(p.pid); }
  return [...ids];
}
export async function stopWorkspaceProcesses(paths) {
  const known = new Set(await workspaceProcesses(paths));
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const pid of [...known, ...await workspaceProcesses(paths)]) {
      known.add(pid); try { process.kill(pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
    for (let i = 0; i < 20; i++) {
      let alive = false;
      for (const pid of known) {
        try { const s = await readFile(`/proc/${pid}/status`, 'utf8'); if (!/^State:\s+Z/m.test(s)) alive = true; } catch { /* exited */ }
      }
      if (!alive && !(await workspaceProcesses(paths)).length) return;
      await pause(50);
    }
  }
  throw new Error('CLEANUP_UNCONFIRMED');
}

/** Installed Codex 0.165.0 provides native, permanent session deletion. Keep
 * account auth, global configuration, other workspaces and shared MCP intact. */
export async function deleteWorkspaceThreads(paths) {
  const ids = new Set();
  for (const archived of [false, true]) {
    let cursor;
    for (let page = 0; page < 100; page++) {
      const result = await codexRead('thread/list', { limit: 100, archived, ...(cursor ? { cursor } : {}) }, '/home/researcher', 5000);
      for (const thread of result.data ?? []) if (paths.some(p => thread.cwd === p || thread.cwd?.startsWith(p + '/'))) {
        if (!/^[a-f0-9-]{36}$/.test(thread.id)) throw new Error('INVALID_THREAD');
        ids.add(thread.id);
      }
      cursor = result.nextCursor;
      if (!cursor) break;
      if (page === 99) throw new Error('THREAD_LIST_LIMIT');
    }
  }
  // Codex's UI list intentionally omits sessions without a user turn, including
  // thread/start + injected local history. Read the pinned version's local
  // index read-only as well; deletion itself always uses Codex's native API.
  const indexed = await promisify(execFile)('python3', ['-c', `import json, os, sqlite3, sys
from pathlib import Path
root = Path(os.environ.get('CODEX_HOME', '/home/researcher/.codex'))
file = root / 'state_5.sqlite'
paths = json.loads(sys.argv[1])
if not file.exists():
 print('[]')
else:
 connection = sqlite3.connect(file.as_uri() + '?mode=ro', uri=True, timeout=5)
 try:
  print(json.dumps([id for id, cwd in connection.execute('SELECT id, cwd FROM threads') if any(cwd == path or cwd.startswith(path + '/') for path in paths)]))
 finally:
  connection.close()
`, JSON.stringify(paths)], { timeout: 8000, maxBuffer: 1024 * 1024 });
  for (const id of JSON.parse(indexed.stdout)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('INVALID_THREAD');
    ids.add(id);
  }
  for (const id of ids) await promisify(execFile)('codex', ['delete', '--force', id], { timeout: 8000, maxBuffer: 32768, cwd: '/home/researcher' });
}

/** Delete only BugHunter's dedicated target Claude state after its processes stop.
 * No global/personal configuration or another target's conversations is touched. */
export async function deleteClaudeWorkspaceThreads(paths) {
  for (const path of paths) {
    if (!/^\/workspaces\/research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(path)) continue;
    const directory = claudeConfigDirectory(path);
    const parent = '/home/researcher/.claude/workspaces';
    for (const item of ['/home/researcher/.claude', parent, directory]) {
      try { const stat = await lstat(item); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UNSAFE_FILE'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await rm(directory, { recursive: true, force: true });
  }
}
