import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { scanLog: { create: vi.fn(async () => ({})) } } }));
vi.mock("@/server/queue/logBus", () => ({ publishScanLog: vi.fn(async () => {}) }));
// Isolate the process primitive; execution/tool confinement has its own tests.
vi.mock("@/server/scanners/toolPolicy", () => ({ enforcedToolArgs: (_cmd: string, args: string[]) => args, safeCommandSummary: () => "test process" }));
import { runCommand } from "@/server/scanners/runCommand";
const opts = { scanRunId: "run", timeoutMs: 2000 };
describe("real runCommand process outcomes", () => {
  it("successful empty output", async () => {
    expect(await runCommand(process.execPath, ["-e", "process.exit(0)"], opts)).toEqual({ code: 0, timedOut: false });
  });
  it("nonzero exit", async () => {
    expect(await runCommand(process.execPath, ["-e", "process.exit(3)"], opts)).toEqual({ code: 3, timedOut: false });
  });
  it("timeout", async () => {
    expect(await runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { ...opts, timeoutMs: 100 })).toMatchObject({ code: null, timedOut: true });
  });
  it("missing executable yields an explicit spawn failure", async () => {
    expect(await runCommand("/missing-bughunter-test-tool", [], opts)).toEqual({ code: null, timedOut: false, spawnFailed: true });
  });
});
