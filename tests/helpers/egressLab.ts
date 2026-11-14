import type { Server } from 'node:net';
import { afterAll } from 'vitest';

/**
 * Local fixtures are private (loopback) and therefore refused by the egress
 * guard. Tests declare each one as an exact administrator lab exception
 * (host:port=127.0.0.1), the same narrow mechanism operators use for labs.
 */
export function allowFixture(server: Server | { address(): unknown }) {
  const address = server.address() as { port: number } | null;
  if (!address?.port) throw new Error('Fixture server is not listening');
  const entry = `127.0.0.1:${address.port}=127.0.0.1`;
  const previous = process.env.EGRESS_LAB_ALLOWLIST;
  process.env.EGRESS_LAB_ALLOWLIST = [previous, entry].filter(Boolean).join(',');
  afterAll(() => { if (previous === undefined) delete process.env.EGRESS_LAB_ALLOWLIST; else process.env.EGRESS_LAB_ALLOWLIST = previous; });
}
/** AI fixtures require their own explicit operator origin, never the lab list. */
export function allowProviderFixture(server: Server | { address(): unknown }) {
  const address = server.address() as { port: number };
  const previous = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${address.port}`;
  afterAll(() => { if (previous === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = previous; });
}
