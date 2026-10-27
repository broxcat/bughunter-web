import { enforcedToolArgs, safeCommandSummary } from "./toolPolicy";
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

import { beforeScanNetwork, currentScanControl, recordUsefulScanWork } from "@/server/scanControl";
import { logger } from "@/lib/logger";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { publishScanLog } from "@/server/queue/logBus";

export type RunCommandOptions = {
  scanRunId: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type RunCommandResult = {
  /** Process exit code, or null if killed by signal/timeout. */
  code: number | null;
  /** True if the run was terminated because it hit the timeout. */
  timedOut: boolean;
  cancelled?: boolean;
  /** Spawn failed before a process could execute (e.g. missing binary). */
  spawnFailed?: boolean;
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
export async function runCommand(
  cmd: string,
  args: string[],
  opts: RunCommandOptions,
): Promise<RunCommandResult> {
  const { scanRunId, timeoutMs } = opts;
  const control = currentScanControl();
  const signal = AbortSignal.any([...(opts.signal ? [opts.signal] : []), ...(control ? [control.signal] : [])]);
  if (signal.aborted) return { code: null, timedOut: false, cancelled: true };
  await beforeScanNetwork();
  if (signal.aborted) return { code: null, timedOut: false, cancelled: true };
  args = enforcedToolArgs(cmd, args);
  const secrets = args.flatMap((arg, i) => {
    if (!["-H", "-header", "-headers", "--header"].includes(args[i - 1]) || /^user-agent\s*:/i.test(arg)) return [];
    const value = arg.slice(arg.indexOf(":") + 1).trim();
    return [value, ...(/^authorization:/i.test(arg) ? [value.replace(/^Bearer\s+/i, "")] : []),
      ...(/^cookie:/i.test(arg) ? value.split(";").map(pair => pair.slice(pair.indexOf("=") + 1).trim()) : [])].filter(Boolean);
  });
  const redact = (line: string) => secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), line);

  const result = await new Promise<RunCommandResult>((resolve) => {
    void record(scanRunId, safeCommandSummary(cmd, args), "STDOUT");

    // shell: false is the whole point — argv array, no shell interpretation.
    const grouped = process.platform !== "win32";
    const child = grouped
      ? spawn(process.execPath, [join(process.cwd(), "src/server/scanners/toolProcess.mjs"), cmd, ...args], { shell: false, detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"] })
      : spawn(cmd, args, { shell: false });
    let toolExit: { code: number | null } | undefined;
    let toolSpawnFailed = false;
    child.on("message", message => {
      if (typeof message !== "object" || message === null) return;
      const data = message as { type?: string; code?: number | null };
      if (data.type === "spawnFailed") {
        toolSpawnFailed = true;
        void record(scanRunId, `[runCommand] failed to spawn ${cmd}: tool unavailable`, "STDERR");
      }
      if (data.type === "toolExit" && (typeof data.code === "number" || data.code === null)) toolExit = { code: data.code };
    });
    child.stdin!.end(); // argv-only tools must receive EOF, not wait on an open pipe.

    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let closed!: () => void;
    const stopped = new Promise<void>(resolve => { closed = resolve; });
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Process/group already exited. */ }
    };
    const stop = (force: boolean) => {
      if (force) kill("SIGKILL");
      else {
        kill("SIGTERM");
        killTimer ??= setTimeout(() => kill("SIGKILL"), 500);
      }
      return stopped;
    };
    const onAbort = () => {
      cancelled = !timedOut;
      logger.info({ scanRunId, ...control?.identity, reason: "PROCESS_ABORTED", tool: cmd }, "scan subprocess interrupted");
      void stop(false);
    };
    const releaseResource = control?.track(stop);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();

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
        void record(scanRunId, redact(line), stream);
      }
    };

    const flush = () => {
      (["STDOUT", "STDERR"] as const).forEach((stream) => {
        if (buffers[stream].length > 0) {
          void record(scanRunId, redact(buffers[stream].replace(/\r$/, "")), stream);
          buffers[stream] = "";
        }
      });
    };

    child.stdout!.on("data", (c: Buffer) => pump(c, "STDOUT"));
    child.stderr!.on("data", (c: Buffer) => pump(c, "STDERR"));

    const timer = setTimeout(() => {
      timedOut = true;
      void record(
        scanRunId,
        `[runCommand] timeout after ${timeoutMs}ms — killing ${cmd}`,
        "STDERR",
      );
      kill("SIGKILL");
    }, timeoutMs);

    const finish = (code: number | null, spawnFailed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener("abort", onAbort);
      kill("SIGKILL"); // Also reap descendants when a parent exits before them.
      closed(); releaseResource?.();
      flush();
      resolve({ code, timedOut, cancelled, ...(spawnFailed ? { spawnFailed: true } : {}) });
    };

    child.on("error", (err) => {
      // e.g. ENOENT: the tool isn't installed. Record and resolve — not fatal.
      void record(scanRunId, `[runCommand] failed to spawn ${cmd}: ${err.message}`, "STDERR");
      finish(null, true);
    });

    child.on("close", (code) => {
      finish(toolSpawnFailed ? null : toolExit ? toolExit.code : code, toolSpawnFailed);
    });
  });
  if (result.code === 0 && !result.timedOut && !result.cancelled) await recordUsefulScanWork();
  return result;
}
