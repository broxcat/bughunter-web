// Self-hosted OOB (out-of-band) interaction catcher — a standalone process
// entrypoint (`npx tsx src/server/oob/server.ts`), run as its own compose
// service (`oob-catcher`), exactly like the worker runs as its own process.
//
// WHY this exists: blind SSRF produces no evidence in the HTTP response. The
// only honest confirmation is a real callback from the scanned target. Public
// interact.sh is unreliable here because the target lives on a private
// Tailscale net, so we host our own catcher and correlate hits through the
// shared Postgres OobHit table.
//
// ─── REACHABILITY: the make-or-break point ──────────────────────────────────
// The catcher must be reachable FROM THE SCANNED TARGET, not merely from the
// worker. It binds 0.0.0.0:8089 inside its container, and docker-compose
// PUBLISHES that port to the host ("8089:8089"). The scanner embeds a callback
// URL built from OOB_PUBLIC_BASE_URL (see ./index.ts); the operator sets that
// env var to a host address the target can route to. For the current Tailscale
// test target (the host itself, 100.121.43.68) the operator sets
//   OOB_PUBLIC_BASE_URL=http://100.121.43.68:8089
// so the injected URL resolves to the host's tailnet IP, the target connects to
// the host's published 8089, Docker forwards it into this container, and a row
// lands in OobHit. The worker then confirms by reading that row via
// checkOobHit() — there is NO worker -> catcher HTTP hop.
//
// The server NEVER crashes on a bad request: every handler is wrapped and DB
// failures are logged, not thrown out of the request lifecycle.

import http from "node:http";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const PORT = 8089;
const HOST = "0.0.0.0";

// An OOB token is a secret capability: anyone who knows it can forge a hit. Never
// log it in full — show only a prefix so a line is still correlatable without
// leaking the token.
function maskToken(token: string): string {
  return token.length <= 8 ? token : `${token.slice(0, 8)}…`;
}

// Matches "/oob/<token>" (optionally with a trailing path/query the target may
// append). Group 1 is the token — url-safe, as minted by generateOobToken().
const OOB_PATH = /^\/oob\/([A-Za-z0-9_-]+)/;

// Keep a bound on how much of a request we read; the catcher never needs the
// body, only the fact of the callback plus headers. This also prevents a huge
// upload from tying the process up.
const MAX_BODY_BYTES = 64 * 1024;

function clientIp(req: http.IncomingMessage): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    // First hop in the chain is the original client.
    return xff.split(",")[0]!.trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0]!.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? null;
}

async function recordHit(
  token: string,
  req: http.IncomingMessage,
): Promise<void> {
  const sourceIp = clientIp(req);
  const method = req.method ?? "UNKNOWN";

  // Prisma Json field: req.headers is a plain object of string | string[].
  await prisma.oobHit.create({
    data: {
      token,
      sourceIp,
      method,
      rawHeaders: req.headers as unknown as object,
    },
  });

  logger.info(
    {
      token: maskToken(token),
      method,
      src: sourceIp ?? "?",
      host: req.headers.host ?? "?",
    },
    "oob-catcher HIT",
  );
}

// Drain and discard the request body so the socket is reusable and a large/slow
// upload can't wedge the connection. Capped at MAX_BODY_BYTES.
function drainBody(req: http.IncomingMessage): void {
  let read = 0;
  req.on("data", (chunk: Buffer) => {
    read += chunk.length;
    if (read > MAX_BODY_BYTES) req.destroy();
  });
  // No "end" handler needed — we respond independently of body completion.
}

const server = http.createServer((req, res) => {
  // Everything inside a try/catch + a promise chain that can never reject out
  // of the callback: a bad request must not take the process down.
  try {
    drainBody(req);

    const url = req.url ?? "/";
    const match = OOB_PATH.exec(url);

    if (match) {
      const token = match[1]!;
      // Fire-and-forget the DB write; respond immediately either way so a slow
      // DB can't hold the target's connection open. Errors are logged only.
      void recordHit(token, req).catch((err) => {
        logger.error(
          {
            token: maskToken(token),
            err: err instanceof Error ? err.message : String(err),
          },
          "oob-catcher failed to record hit",
        );
      });

      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }

    // Any non-/oob path: 404, no logging noise.
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "oob-catcher request handler error",
    );
    try {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end();
    } catch {
      // Socket already gone — nothing to do.
    }
  }
});

// A malformed request (bad HTTP) surfaces here rather than as an exception.
server.on("clientError", (err, socket) => {
  logger.error({ err: err.message }, "oob-catcher clientError");
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  }
});

server.listen(PORT, HOST, () => {
  logger.info(`oob-catcher listening on http://${HOST}:${PORT} — catch-all /oob/<token>`);
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`oob-catcher ${signal} received, closing...`);
  server.close(() => process.exit(0));
  // Safety net if sockets keep the server from closing promptly.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { server };
