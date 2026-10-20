import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { subscribeScanLog } from "@/server/queue/logBus";

// Live scan-log stream. Must run on the Node runtime (long-lived ReadableStream +
// Redis pub/sub via logBus); never statically rendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shape shared with logBus.publishScanLog / subscribeScanLog and the viewer.
type LogEntry = { line: string; stream: "STDOUT" | "STDERR"; createdAt: string };

// ScanStatus values at which the run is over and the stream should close.
const TERMINAL = new Set<string>(["COMPLETED", "FAILED", "CANCELLED"]);
const POLL_INTERVAL_MS = 2000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  // Ownership is proven through Target.userId. A run that doesn't exist and one
  // owned by someone else are both reported as 404 so we never leak existence.
  const scanRun = await prisma.scanRun.findUnique({
    where: { id },
    include: { target: true },
  });
  if (!scanRun || scanRun.target.userId !== session.user.id) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  // State shared between start() and cancel() so a client disconnect tears down
  // the subscription and the poll timer.
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        // subscription already torn down
      }
      unsubscribe = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller closed underneath us (client gone); stop sending.
          closed = true;
        }
      };

      const finish = (status: string) => {
        if (closed) return;
        send("status", { status });
        cleanup();
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // 1. Replay the full backlog in chronological order.
      const backlog = await prisma.scanLog.findMany({
        where: { scanRunId: id },
        orderBy: { createdAt: "asc" },
      });
      for (const row of backlog) {
        send("log", {
          line: row.line,
          stream: row.stream,
          createdAt: row.createdAt.toISOString(),
        } satisfies LogEntry);
      }

      // 2. Already finished: emit the terminal status once and close.
      if (TERMINAL.has(scanRun.status)) {
        finish(scanRun.status);
        return;
      }

      // 3. Subscribe to live lines. If the bus is unavailable we still fall back
      //    to status polling below so the client eventually learns it's done.
      try {
        unsubscribe = await subscribeScanLog(id, (entry: LogEntry) => {
          send("log", entry);
        });
      } catch {
        // no live tail; polling still drives the terminal status event.
      }

      // The client may have disconnected while we awaited the subscription.
      if (closed) {
        cleanup();
        return;
      }

      // 4. Poll the run status; when it becomes terminal, send the final status
      //    event, unsubscribe and close. A comment line doubles as a heartbeat
      //    so intermediary proxies keep the connection open.
      interval = setInterval(async () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
          cleanup();
          return;
        }
        try {
          const fresh = await prisma.scanRun.findUnique({
            where: { id },
            select: { status: true },
          });
          if (!fresh) {
            finish("FAILED");
            return;
          }
          if (TERMINAL.has(fresh.status)) {
            finish(fresh.status);
          }
        } catch {
          // transient DB hiccup; try again on the next tick.
        }
      }, POLL_INTERVAL_MS);
    },

    cancel() {
      closed = true;
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
