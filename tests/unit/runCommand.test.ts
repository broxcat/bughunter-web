import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { scanLog: { create: vi.fn(async () => ({})) } } }));
vi.mock("@/server/queue/logBus", () => ({ publishScanLog: vi.fn(async () => {}) }));
// Isolate the process primitive; execution/tool confinement has its own tests.
vi.mock("@/server/scanners/toolPolicy", () => ({ enforcedToolArgs: (_cmd: string, args: string[]) => args, safeCommandSummary: () => "test process" }));
import { prisma } from "@/lib/prisma";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runCommand } from "@/server/scanners/runCommand";
const opts = { scanRunId: "run", timeoutMs: 2000 };
describe("real runCommand process outcomes", () => {
  it('delivers stdout discoveries incrementally, including a final line without newline, before returning',async()=>{
    const lines:string[]=[];let finish!:()=>void;
    const first=new Promise<void>(resolve=>{finish=resolve;});
    let completed=false;
    const run=runCommand(process.execPath,['-e','console.log("api.example.test");setTimeout(()=>process.stdout.write("www.example.test"),200)'],{...opts,onStdoutLine:async line=>{lines.push(line);finish();}}).then(result=>{completed=true;return result;});
    await first;expect(completed).toBe(false);expect(lines).toEqual(['api.example.test']);
    expect(await run).toMatchObject({code:0});expect(lines).toEqual(['api.example.test','www.example.test']);
  });
  it('propagates failed persistence and stops the enumerator rather than reporting success',async()=>{
    await expect(runCommand(process.execPath,['-e','console.log("api.example.test");setInterval(()=>{},1000)'],{...opts,onStdoutLine:async()=>{throw new Error('Persistence failed');}})).rejects.toThrow('Persistence failed');
  });
  it('stops consuming buffered discoveries at the tool timeout and drains the in-flight write',async()=>{
    let writes=0;
    const result=await runCommand(process.execPath,['-e','for(let n=0;n<100;n++)console.log("h"+n+".example.test");setInterval(()=>{},1000)'],{...opts,timeoutMs:150,onStdoutLine:async()=>{writes++;await new Promise(resolve=>setTimeout(resolve,50));}});
    expect(result.timedOut).toBe(true);expect(writes).toBeLessThan(5);const completed=writes;
    await new Promise(resolve=>setTimeout(resolve,60));expect(writes).toBe(completed);
  });
  it("successful empty output", async () => {
    expect(await runCommand(process.execPath, ["-e", "process.exit(0)"], opts)).toEqual({ code: 0, timedOut: false, cancelled: false });
  });
  it("nonzero exit", async () => {
    expect(await runCommand(process.execPath, ["-e", "process.exit(3)"], opts)).toEqual({ code: 3, timedOut: false, cancelled: false });
  });
  it("timeout", async () => {
    expect(await runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { ...opts, timeoutMs: 100 })).toMatchObject({ code: null, timedOut: true });
  });
  it("missing executable yields an explicit spawn failure", async () => {
    expect(await runCommand("/missing-bughunter-test-tool", [], opts)).toEqual({ code: null, timedOut: false, cancelled: false, spawnFailed: true });
  });
});

describe("runCommand cancellation and process groups", () => {
  it("an aborted signal never spawns a process", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await runCommand("/must-not-be-spawned", [], { ...opts, signal: controller.signal })).toEqual({ code: null, timedOut: false, cancelled: true });
  });
  async function abortRunning(script: string) {
    const controller = new AbortController();
    const start = vi.mocked(prisma.scanLog.create).mock.calls.length;
    const running = runCommand(process.execPath, ["-e", script], { ...opts, timeoutMs: 5000, signal: controller.signal });
    await vi.waitFor(() => expect(vi.mocked(prisma.scanLog.create).mock.calls.slice(start).some(c => String(c[0].data.line).includes("PROCESS_READY"))).toBe(true));
    controller.abort(); return running;
  }
  it("SIGTERM-aware processes stop without a timeout", async () => {
    expect(await abortRunning('process.on("SIGTERM", () => process.exit(0)); console.log("PROCESS_READY"); setInterval(() => {}, 1000)')).toEqual({ code: 0, timedOut: false, cancelled: true });
  });
  it("SIGTERM-resistant processes are killed after the short grace period", async () => {
    expect(await abortRunning('process.on("SIGTERM", () => {}); console.log("PROCESS_READY"); setInterval(() => {}, 1000)')).toEqual({ code: null, timedOut: false, cancelled: true });
  });
  it("stops the Unix process group even when the parent exits before its descendant", async () => {
    const descendant = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
    const script = `const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"}); console.log("CHILD_PID="+child.pid); process.on("SIGTERM",()=>process.exit(0)); console.log("PROCESS_READY");setInterval(()=>{},1000)`;
    const start = vi.mocked(prisma.scanLog.create).mock.calls.length;
    await abortRunning(script);
    const pidLine = vi.mocked(prisma.scanLog.create).mock.calls.slice(start).map(c => String(c[0].data.line)).find(line => line.startsWith("CHILD_PID="))!;
    const pid = Number(pidLine.split("=")[1]); expect(pid).toBeGreaterThan(1);
    await vi.waitFor(async () => {
      const state = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "gone");
      expect(state === "gone" || state.split(") ")[1]?.startsWith("Z")).toBe(true);
    });
  });
  it("the supervisor kills the tool group when its worker owner is SIGKILLed", async () => {
    const helper = join(process.cwd(), "src/server/scanners/toolProcess.mjs");
    const tool = 'console.log("TOOL_PID="+process.pid);setInterval(()=>{},1000)';
    const ownerCode = `const {spawn}=require("node:child_process");const group=spawn(process.execPath,[${JSON.stringify(helper)},process.execPath,"-e",${JSON.stringify(tool)}],{detached:true,stdio:["ignore","inherit","inherit","ipc"]});console.log("GROUP_PID="+group.pid);setInterval(()=>{},1000)`;
    const owner = spawn(process.execPath, ["-e", ownerCode], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; owner.stdout.on("data", chunk => { output += chunk; });
    try {
      await vi.waitFor(() => expect(output).toMatch(/TOOL_PID=\d+/));
      const pid = Number(/TOOL_PID=(\d+)/.exec(output)![1]);
      const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
      await vi.waitFor(async () => {
        const state = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "gone");
        expect(state === "gone" || state.split(") ")[1]?.startsWith("Z")).toBe(true);
      });
    } finally {
      owner.kill("SIGKILL"); const groupId = Number(/GROUP_PID=(\d+)/.exec(output)?.[1]);
      if (groupId > 1) try { process.kill(-groupId, "SIGKILL"); } catch { /* Already reaped. */ }
    }
  });

});
