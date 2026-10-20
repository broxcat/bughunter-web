// runCommand — the single, security-critical primitive every scanner uses to
// spawn an external tool.
//
// SECURITY INVARIANT (non-negotiable): the scanned host is user input. It is
// passed ONLY as an argv element, NEVER interpolated into a shell string. We
// spawn with `shell: false` and an argv array so a host like
// `example.com; rm -rf /` can never break out of its argument into a command.
// Nothing in this file may introduce a shell.
//
// Each stdout/stderr line is both persisted (a ScanLog row) and published to the
// live log bus for SSE. The call never throws on a non-zero exit — it resolves
// with the exit code — so a tool that "fails" is a normal, recordable outcome.

import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { publishScanLog } from "@/server/queue/logBus";

export type RunCommandOptions = {
  scanRunId: string;
  timeoutMs: number;
};

export type RunCommandResult = {
  /** Process exit code, or null if killed by signal/timeout. */
  code: number | null;
  /** True if the run was terminated because it hit the timeout. */
  timedOut: boolean;
};

async function record(
  scanRunId: string,
  line: string,
  stream: "STDOUT" | "STDERR",
): Promise<void> {
  const createdAt = new Date();
  // Persist first so the SSE replay-from-DB path and the live stream agree.
  await prisma.scanLog
    .create({ data: { scanRunId, line, stream } })
    .catch(() => {});
  await publishScanLog(scanRunId, {
    line,
    stream,
    createdAt: createdAt.toISOString(),
  }).catch(() => {});
}

/**
 * Spawn `cmd` with the given argv `args` (NEVER a shell string), streaming
 * output line-by-line into ScanLog + the live bus, enforcing a hard timeout.
 * Resolves with the exit code; does not throw on non-zero exit.
 */
export function runCommand(
  cmd: string,
  args: string[],
  opts: RunCommandOptions,
): Promise<RunCommandResult> {
  const { scanRunId, timeoutMs } = opts;

  return new Promise<RunCommandResult>((resolve) => {
    void record(scanRunId, `$ ${cmd} ${args.join(" ")}`, "STDOUT");

    // shell: false is the whole point — argv array, no shell interpretation.
    const child = spawn(cmd, args, { shell: false });

    let settled = false;
    let timedOut = false;

    // Buffer partial lines per stream so we only emit complete lines.
    const buffers: Record<"STDOUT" | "STDERR", string> = {
      STDOUT: "",
      STDERR: "",
    };

    const pump = (chunk: Buffer, stream: "STDOUT" | "STDERR") => {
      buffers[stream] += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffers[stream].indexOf("\n")) !== -1) {
        const line = buffers[stream].slice(0, idx).replace(/\r$/, "");
        buffers[stream] = buffers[stream].slice(idx + 1);
        void record(scanRunId, line, stream);
      }
    };

    const flush = () => {
      (["STDOUT", "STDERR"] as const).forEach((stream) => {
        if (buffers[stream].length > 0) {
          void record(scanRunId, buffers[stream].replace(/\r$/, ""), stream);
          buffers[stream] = "";
        }
      });
    };

    child.stdout.on("data", (c: Buffer) => pump(c, "STDOUT"));
    child.stderr.on("data", (c: Buffer) => pump(c, "STDERR"));

    const timer = setTimeout(() => {
      timedOut = true;
      void record(
        scanRunId,
        `[runCommand] timeout after ${timeoutMs}ms — killing ${cmd}`,
        "STDERR",
      );
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      flush();
      resolve({ code, timedOut });
    };

    child.on("error", (err) => {
      // e.g. ENOENT: the tool isn't installed. Record and resolve — not fatal.
      void record(scanRunId, `[runCommand] failed to spawn ${cmd}: ${err.message}`, "STDERR");
      finish(null);
    });

    child.on("close", (code) => {
      finish(code);
    });
  });
}
