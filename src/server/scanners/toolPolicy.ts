import { join } from "node:path";
import { assertExecutionUrl, currentTargetExecution } from "@/server/execution";

export const TOOL_CONFIG = join(process.cwd(), "src/server/scanners/templates/config.yaml");
export const DALFOX_CONFIG = join(process.cwd(), "src/server/scanners/templates/dalfox-config.json");
export const NUCLEI_TEMPLATE = join(process.cwd(), "src/server/scanners/templates/git-config.yaml");
const HTTP_TOOLS = new Set(["httpx", "katana", "nuclei", "dalfox"]);
/** The backend is the final writer of UA headers, even if a caller proposes one. */
export function enforcedToolArgs(cmd: string, args: string[]): string[] {
  const ctx = currentTargetExecution();
  if (ctx.requestGuard) throw new Error("External CLI request counts cannot be enforced inside a bounded Hunt");
  if (cmd === "nmap") return ["-sT", "-Pn", "-n", ctx.host.split(":")[0]];
  if (!HTTP_TOOLS.has(cmd)) throw new Error("Unaudited scanner tool; refusing execution");
  for (const arg of args) if (/^https?:\/\//i.test(arg)) assertExecutionUrl(arg, ctx);
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (["-H", "-header", "-headers", "--header"].includes(flag) && /^user-agent\s*:/i.test(args[i + 1] ?? "")) { i++; continue; }
    if (["--user-agent", "-user-agent"].includes(flag)) { i++; continue; }
    if (/^(?:--user-agent=|-H=User-Agent:|-header=User-Agent:)/i.test(flag)) continue;
    clean.push(flag);
  }
  if (cmd === "dalfox") return [...clean, "--user-agent", ctx.requiredUserAgent, "--skip-headless", "--skip-bav", "--config", DALFOX_CONFIG];
  return [...clean, "-H", `User-Agent: ${ctx.requiredUserAgent}`, "-config", TOOL_CONFIG,
    ...(cmd === "httpx" ? ["-random-agent=false", "-nfs", "-duc"] : []),
    ...(cmd === "katana" ? ["-dr", "-fs", "fqdn", "-cs", `^https?://${ctx.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/|$)`, "-duc"] : []),
    ...(cmd === "nuclei" ? ["-dr", "-ni", "-pt", "http"] : []),
  ];
}
/** Redact request credentials and URL query values from CLI log metadata. */
export function safeCommandSummary(cmd: string, args: string[]): string {
  return `$ ${cmd} ${args.map((arg, i) => {
    if (["-H", "-header", "-headers", "--header"].includes(args[i - 1]) && !/^user-agent\s*:/i.test(arg)) return "[REDACTED HEADER]";
    if (/^https?:\/\//.test(arg)) { try { const u = new URL(arg); u.search = u.search ? "?[REDACTED]" : ""; u.username = ""; u.password = ""; return u.toString(); } catch { return "[URL]"; } }
    return arg;
  }).join(" ")}`;
}
