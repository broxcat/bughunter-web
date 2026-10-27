// Unix process-group supervisor. IPC disconnect also fires when the worker is
// SIGKILLed, so an orphaned scanner cannot keep issuing requests after a crash.
// The tool inherits this process group; no shell or command-string parsing.
import { spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const killGroup = () => { try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(1); } };
process.on("disconnect", killGroup);
// The parent sends SIGTERM to the entire group. Stay alive to supervise tools
// that need the parent's subsequent SIGKILL after their grace period.
process.on("SIGTERM", () => {});
if (!process.connected || !command) killGroup();
const tool = spawn(command, args, { shell: false, stdio: ["ignore", "inherit", "inherit"] });
let spawnFailed = false;
tool.on("error", () => {
  spawnFailed = true;
  if (process.connected) process.send({ type: "spawnFailed" }, () => process.exit(127));
  else killGroup();
});
tool.on("close", (code, signal) => {
  if (spawnFailed) return;
  if (process.connected) process.send({ type: "toolExit", code }, () => process.exit(code ?? (signal ? 1 : 0)));
  else killGroup();
});
