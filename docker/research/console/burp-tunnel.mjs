import { createServer, connect } from 'node:net';
// Preserve Burp's localhost Host validation and existing CLI endpoints. The
// upstream namespace is independent; every new socket resolves Docker DNS again.
export async function startBurpTunnel(host = process.env.BURP_SERVICE_HOST) {
  if (!host) return [];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host)) throw new Error('INVALID_BURP_SERVICE');
  const servers = [];
  for (const [local, remote] of [[9876, 9877], [8080, 8081]]) {
    const server = createServer(client => {
      const upstream = connect(remote, host);
      const deadline = setTimeout(() => upstream.destroy(), 3000);
      const close = () => { clearTimeout(deadline); client.destroy(); upstream.destroy(); };
      upstream.once('connect', () => { clearTimeout(deadline); client.pipe(upstream); upstream.pipe(client); });
      client.on('error', close); upstream.on('error', close);
      client.on('close', close); upstream.on('close', close);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(local, '127.0.0.1', resolve); });
    servers.push(server);
  }
  return servers;
}
