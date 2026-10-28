import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { workspaceProcesses } from './stop.mjs';
import { diagnoseOfficialBurp } from '../validator/burp-proxy.mjs';
export async function reconnectWorkspaceBurp(cwd) {
  const diagnostics = [];
  for (const pid of await workspaceProcesses([cwd])) {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    if (!command.split('\0').includes('/opt/bughunter/docker/research/validator/portswigger-main.mjs')) continue;
    diagnostics.push(await new Promise(resolve => {
      let data = '';
      const socket = connect(`/tmp/bughunter-burp-${pid}.sock`);
      const fail = () => { socket.destroy(); resolve({ status: 'unavailable', toolCount: 0 }); };
      socket.setTimeout(15000, fail); socket.on('error', fail);
      socket.once('connect', () => socket.write('reconnect\n'));
      socket.on('data', chunk => { data += chunk; if (data.length > 32768) fail(); });
      socket.once('end', () => { try { resolve(JSON.parse(data)); } catch { fail(); } });
    }));
  }
  // A console whose relay has not yet started still gets an actual probe.
  return diagnostics.length ? diagnostics.find(d => d.status !== 'connected') ?? diagnostics[0] : diagnoseOfficialBurp();
}
