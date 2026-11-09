import { z } from "zod";
import { requiredUserAgentSchema } from "../httpPolicy.mjs";
import { assetAllowsHost, assetAllowsUrl } from '../scopeAssets.ts';
const targetIdentity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);

export const consolePolicySchema = z.strictObject({
  version: z.literal(2), sessionId: targetIdentity, targetId: targetIdentity,
  workspaceId: z.string().regex(/^research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
  targetHost: z.string().max(253).regex(/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/),
  scheme: z.enum(["http", "https"]), port: z.number().int().min(1).max(65535),
  assetScope: z.object({ normalizedValue: z.string().max(2048), format: z.string().max(40), active: z.boolean() }).optional(),
  requiredUserAgent: z.union([z.literal(''), requiredUserAgentSchema.refine(value => !/\\[rn]/.test(value), "Literal HTTP line escapes are unsupported by the Burp upstream")]),
  trafficCapability: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  authorizationSource: z.string().min(1).max(200), generatedAt: z.iso.datetime(),
  scopeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["SCOPED_ACTIVE_HTTP", "PROGRAM_PASSIVE"]),
  programScope: z.object({ rules: z.array(z.string().max(253)).max(1000), exclusions: z.array(z.string().max(253)).max(1000) }).optional(),
}).refine(p => p.workspaceId === `research_${p.targetId}` && (p.assetScope ? p.mode === 'PROGRAM_PASSIVE' || (assetAllowsHost(p.assetScope, p.targetHost) && assetAllowsUrl(p.assetScope, `${p.scheme}://${p.targetHost}:${p.port}${p.assetScope.format === 'URL' ? new URL(p.assetScope.normalizedValue).pathname : '/'}`)) : p.port === (p.scheme === 'https' ? 443 : 80)));
export type ConsolePolicy = z.infer<typeof consolePolicySchema>;
export function consoleCodexConfig(workspaceId: string, instructions: string, passive = false) {
  if (!/^research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(workspaceId)) throw new Error("Invalid workspace");
  return `# Generated BugHunter project config. No account credentials.\n` +
    `developer_instructions = ${JSON.stringify(instructions)}\n` +
    `[features]\nmulti_agent = true\n[agents]\nmax_threads = 4\n` +
    `[mcp_servers.burp]\ncommand = "/usr/local/bin/bughunter-portswigger-mcp"\ncwd = "/workspaces/${workspaceId}"\nrequired = false\nstartup_timeout_sec = 15\ntool_timeout_sec = 30\n` +
    `[mcp_servers.bughunter_burp]\ncommand = "/usr/local/bin/bughunter-burp-mcp"\ncwd = "/workspaces/${workspaceId}"\nrequired = false\nstartup_timeout_sec = 5\ntool_timeout_sec = 20\n` +
    (passive ? `enabled_tools = ["burp_status", "burp_history", "burp_save_observation"]\n` : `enabled_tools = ["burp_status", "burp_history", "burp_save_observation", "send_http1_request", "send_http2_request"]\n`) +
    (passive ? "" : `[mcp_servers.playwright]\ncommand = "/usr/local/bin/bughunter-playwright-mcp"\ncwd = "/workspaces/${workspaceId}"\nrequired = false\nstartup_timeout_sec = 5\ntool_timeout_sec = 30\nenabled_tools = ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_fill_form", "browser_press_key", "browser_select_option", "browser_wait_for", "browser_navigate_back", "browser_tabs", "browser_network_requests", "browser_console_messages", "browser_take_screenshot", "browser_evaluate", "browser_close"]\n`);
}
