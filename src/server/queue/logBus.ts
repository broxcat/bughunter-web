// Live scan-log pub/sub over Redis. The worker publishes every stdout/stderr
// line as it is produced; the SSE route subscribes per scan run and relays lines
// to the browser. Persistence of lines is separate (the worker also writes a
// ScanLog row) — this bus is only the realtime fan-out.
//
// Channel: `scanlog:<scanRunId>`. Publishing uses the shared command connection;
// subscribing uses a dedicated connection (a client in subscriber mode cannot
// run ordinary commands), one per subscription, torn down by the returned
// unsubscribe function.

import { redis, createRedisConnection } from "./connection";

export type ScanLogEntry = {
  line: string;
  stream: "STDOUT" | "STDERR";
  createdAt: string;
};

function channelFor(scanRunId: string): string {
  return `scanlog:${scanRunId}`;
}

/** Publish one log line to all subscribers of this scan run. */
export async function publishScanLog(
  scanRunId: string,
  entry: ScanLogEntry,
): Promise<void> {
  await redis.publish(channelFor(scanRunId), JSON.stringify(entry));
}

/**
 * Subscribe to a scan run's live log lines. `cb` is invoked for each entry.
 * Resolves to an unsubscribe function that stops delivery and closes the
 * dedicated subscriber connection.
 */
export async function subscribeScanLog(
  scanRunId: string,
  cb: (entry: ScanLogEntry) => void,
): Promise<() => void> {
  const channel = channelFor(scanRunId);
  const sub = createRedisConnection();

  const onMessage = (ch: string, payload: string) => {
    if (ch !== channel) return;
    try {
      cb(JSON.parse(payload) as ScanLogEntry);
    } catch {
      // Ignore malformed payloads rather than tearing down the stream.
    }
  };

  sub.on("message", onMessage);
  await sub.subscribe(channel);

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    sub.off("message", onMessage);
    // Best-effort unsubscribe, then drop the connection.
    void sub.unsubscribe(channel).catch(() => {});
    void sub.quit().catch(() => {});
  };
}
