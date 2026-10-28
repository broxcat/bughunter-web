import { spawn } from 'node:child_process';
/** Native PTY streams remain untouched; lifecycle errors are safe, bounded messages.
 * @param {string} file
 * @param {string[]} args
 * @param {object} options
 * @param {(file: string, args: string[], options: object) => import('node:events').EventEmitter & {kill: (signal: string) => unknown}} spawnProcess
 * @returns {Promise<number>}
 */
export function runInteractiveCli(file, args, options, spawnProcess = spawn) {
  let child;
  try { child = spawnProcess(file, args, { ...options, stdio: 'inherit', shell: false }); }
  catch { return Promise.resolve(1); }
  const handlers = new Map();
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    const handler = () => child.kill(signal); handlers.set(signal, handler); process.on(signal, handler);
  }
  return new Promise(resolve => {
    let finished = false;
    const finish = code => {
      if (finished) return; finished = true;
      for (const [signal, handler] of handlers) process.off(signal, handler);
      resolve(code);
    };
    child.once('error', () => { console.error('Research CLI could not start. Check installation and authentication.'); finish(1); });
    child.once('exit', (code, signal) => finish(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : signal === 'SIGHUP' ? 129 : 1)));
  });
}
