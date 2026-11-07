# Research launcher contract

Console ownership decision: **PER_HOST**. A business Target is a BountyProgram; execution identity and workspace belong to a technical Target. The existing workspace is `/workspaces/research_<validated Target ID>`. No migration is performed.

| Concern | Per technical host (retained) | Per program with host switching (rejected) |
|---|---|---|
| Authorization / stale policy | Existing immutable authorization snapshot and admission | Requires changing the binding while preserving old snapshots |
| Recon / evidence | Existing host context, plan, coverage and evidence references | Risks confusing observations and execution identity across hosts |
| Concurrent work | Distinct host workspaces and existing engine tmux names | Requires another host selection/isolation layer |
| Persistence | Existing Codex and Claude conversations reconnect independently | Requires workspace/session migration and new recovery semantics |
| User context | Program and exact host remain visible | Host switching adds an avoidable source of mistakes |

## Verified capabilities

Inspected native `--version` and `--help` on 2026-11-07, both on the host and in a disposable `--network none` console-image container. Host: Codex 0.167.0, Claude Code 2.1.318. **The actual Research image pins Codex 0.165.0 and Claude Code 2.1.312.** Host capabilities do not substitute for image verification. No CLI pin or dependency change.

| Capability | Codex 0.165.0 | Claude Code 2.1.312 |
|---|---|---|
| Native login and persistent auth | `login status`; existing dedicated Codex home | `auth status` structured `loggedIn`; existing separate configuration home per host |
| Web Standard | `--ask-for-approval on-request --sandbox workspace-write` | `--permission-mode manual`; existing passive Read/Glob/Grep/Edit/Write and scoped passive MCP only |
| Other Web profile | Existing `--yolo` | `--permission-mode plan`; same passive tool allowlist |
| Native model selection | `--model`; native configuration/selector only | `--model`; native `/model` only |
| Bypass permissions | Verified native YOLO, exposed with explanation | Native `--dangerously-skip-permissions` exists, deliberately **not exposed**; no invented parity |
| Agents / subagents | No verified dedicated generic CLI launch toggle; not exposed | Native `--agent` / `--agents` exist; arbitrary agent/config JSON is **not exposed** |
| Agent teams | No verified Web launch contract | No verified Web launch contract |
| Ollama / local route | Native `--oss --local-provider ollama` documented in installed help; no verified repository local profile/model/endpoint, so **operator-only, not exposed** | No native Ollama option in inspected help; no repository wrapper route or verified proxy, **not exposed** |
| MCP | Existing server-owned scoped bridge/config retained | Existing strict passive MCP configuration retained |
| tmux | BugHunter persistence, not a model feature | BugHunter persistence, separate engine session |

Model names/catalogs are not invented, subscriptions do not imply API credits, provider authentication is not modified and local inference is never substituted. No local model mode is claimed as accepted by the Web launcher. No new endpoint/model/agent/MCP fields are accepted from a browser.

## Entry and readiness

`/research` keeps its server-side owner pagination, program/host context, Scope admission, Recon lifecycle/outcome, Research Plan and Coverage. Each host has an engine/profile launcher. Readiness is an explicit read-only action, not a per-render polling loop. It reports only installation, sanitized version, authenticated/login-required/unknown and running profile. A missing/failed probe remains Unknown; it never grants authorization. Native login remains available in the console. Stale snapshots and pending deletion have an explicit blocked entry state; the existing evidence-preserving removal/recreation flow remains available.

`GET /api/research-targets/:id/launcher` authenticates and checks current ownership and Scope before issuing a separate 30-second signed **read-only launcher audience** to the internal control service. It does not provision a workspace, start a session, perform inference or copy credentials. Native help/auth probes have bounded deadlines/output, no shell, a 15-second per-host single-flight cache, at most 128 entries and four simultaneous host probes. Raw provider output/account data is never returned or cached. Claude auth uses the existing per-host configuration directory; global Claude login is not mistaken for host login.

The installed runner help determines which profiles are advertised. Terminal startup verifies support again, independently of browser/UI state. Unknown profiles, provider/profile mismatches, extra body fields and arbitrary paths/arguments/environment/config/model endpoints are rejected. Historical empty-body/provider-only terminal requests retain Codex YOLO / Claude Standard defaults. Direct engine/profile URLs are strictly parsed; refresh retains the selected profile. Explicit engine switching updates the URL and retains the other engine's existing tmux process.

## Session and security invariants

- Existing tmux names remain `bughunter-<Target ID>` and `bughunter_claude_<Target ID>`. Browser detach/refresh/reconnect never kills them. Container restart retains workspace/auth/history volumes; tmux itself restarts, as in the existing contract.
- Profiles do not create extra sessions. A new tmux session receives a server-owned `BUGHUNTER_LAUNCH_PROFILE` environment value **atomically at creation**. Concurrent callers then verify the actual stored profile before attaching. An untagged historical session has its known legacy default. Unknown metadata or ambiguous process probes fail closed.
- A different requested profile returns `PROFILE_CONFLICT`, preserving the existing pane and conversation. The launcher offers reconnecting to the running profile. No automatic kill/restart. A failed creation/racing loser never cleans up another session.
- The selected profile is signed into terminal tickets and bound during renewal alongside provider, user, session, host and policy digest. It never comes from shell text. Short leases continue to invoke existing current authorization/stale-policy validation.
- YOLO bypasses **native Codex approval/sandbox prompts**, not BugHunter Scope admission, trusted execution isolation, exclusions or methodology confirmation gates. Claude Plan/Standard retain passive tool and MCP restrictions; no Bash/active traffic tools are added.
- Workspace bootstrap, immutable `scope.md`, AGENTS instructions, Recon context, plan/coverage and hypothesis/evidence references are reused unchanged. Reconnect does not refresh authorization by rewriting Markdown. Discovery remains non-authoritative.
- The five operator diagnostics WIP files were reviewed and **not incorporated**. Existing committed `providerStatus` is reused. In particular, global diagnostic caching cannot substitute for Claude's per-host login. Focused launcher edits to clean baseline terminal/server files are separate from the original untouched WIP bytes.

## Validation

Focused tests cover strict selections, native permission arguments, signed audiences/profile tampering boundaries, sanitized auth states, unsupported help, legacy/running identity, bounded cache and ambiguous-probe refusal. Disposable browser tests cover both engines/auth states, profiles, conflicts, stale/revoked policy, direct URLs, navigation, keyboard and 1280/390 light/dark. The native Research suite exercises actual pinned processes, CWD, startup/MCP, profile conflicts, independent panes, refresh/browser reopen, restart, current revocation and workspace/network isolation with **empty disposable provider homes**, without paid inference. Exact results and CI SHA are recorded in the Milestone 7 checkpoint in `post-v1-overhaul.md`.
