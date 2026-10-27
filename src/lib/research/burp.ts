import { z } from "zod";
import { requiredUserAgentSchema } from "../httpPolicy.mjs";

// Fixed, runner-only endpoint. Never accept a URL/command from a browser or target.
export const BURP_ENDPOINT = "http://127.0.0.1:9876/";
export const BURP_EXTENSION_VERSION = "1.3.0";
export const BURP_TOOLS = ["burp_status", "burp_history", "burp_save_observation"] as const;
export const workspaceIdSchema = z.uuid({ version: "v4" });
export const burpPolicySchema = z.strictObject({
  version: z.literal(1), sessionId: z.string().min(1).max(100), workspaceId: workspaceIdSchema,
  targetId: z.string().min(1).max(100),
  targetHost: z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+$/),
  scheme: z.enum(["http", "https"]),
  requiredUserAgent: z.string().refine(value => value === value.trim()).pipe(requiredUserAgentSchema),
  authorizationSource: z.string().min(1).max(200), generatedAt: z.iso.datetime(),
  scopeFile: z.literal("scope.md"), programPolicyFile: z.literal("program-policy.md"),
  mode: z.literal("PASSIVE_METADATA_ONLY"),
});
export type BurpPolicy = z.infer<typeof burpPolicySchema>;

export function burpCodexOverrides(workspaceId: string) {
  workspaceIdSchema.parse(workspaceId);
  return [
    'mcp_servers.bughunter_burp.command="/usr/local/bin/bughunter-burp-mcp"',
    `mcp_servers.bughunter_burp.cwd="/workspaces/${workspaceId}"`,
    "mcp_servers.bughunter_burp.required=false",
    "mcp_servers.bughunter_burp.startup_timeout_sec=5",
    "mcp_servers.bughunter_burp.tool_timeout_sec=8",
    `mcp_servers.bughunter_burp.enabled_tools=${JSON.stringify(BURP_TOOLS)}`,
  ];
}
export function burpCodexConfig(workspaceId: string) {
  return "# Reference only. bughunter-codex injects root-owned configuration.\n" +
    burpCodexOverrides(workspaceId).join("\n") + "\n";
}

export const burpDiagnosticSchema = z.strictObject({
  version: z.literal(1), workspaceId: workspaceIdSchema,
  checkedAt: z.iso.datetime(), runner: z.literal("AVAILABLE"),
  configuration: z.enum(["CONFIGURED", "UNAVAILABLE"]),
  upstream: z.enum(["AVAILABLE", "UNAVAILABLE", "TIMEOUT", "INCOMPATIBLE", "NOT_CHECKED"]),
  mode: z.literal("PASSIVE_METADATA_ONLY"),
});
export type BurpDiagnostic = z.infer<typeof burpDiagnosticSchema>;
