# Claude Code in Research

Research offers Codex CLI and Claude Code in the existing terminal. This change
adds an **interactive passive Claude console**. It does not implement active
Claude vulnerability testing or the four offensive security skills requested for
Claude. Codex's existing skills and tools retain their configuration.

## Operation

Apply the additive migration with `npx prisma migrate deploy`, rebuild the web
and Research images and recreate those services. Never reset the database.
Select **Moteur IA → Claude Code → Open Claude Code** in Research. The choice is
saved on ResearchSession; existing rows default to Codex. `/login` authenticates
Claude and `/model` selects a model using its native UI. Authentication alone
never certifies subscription quota or model access.

The runner pins Codex 0.165.0 and Claude Code 2.1.312. A dedicated
`research-claude` volume holds `/home/researcher/.claude`. Each target uses its
own `workspaces/<targetId>` configuration directory and login; there is no copy
of a host login or modification of personal/global Claude configuration. Tokens
are managed by Claude, never copied into the image, API responses or diagnostics.
Do not authenticate a disposable acceptance-test container with a real account.

## Shared architecture and compatibility

The same authenticated ticket endpoint, Ed25519 authorization, immutable scope
snapshot, Recon workspace, xterm stream, WebSocket protocol, lease renewal and
cleanup service serve both providers. The optional provider claim defaults to
Codex; Codex tickets keep their historical shape. Deploy web and runner together
before using Claude. Old clients continue to request the saved/default engine.

The adapter registry fixes executable/launcher paths; browser input can select
only an enum. There is no browser command, path, MCP configuration or shell
interpolation. Availability probes have time/output limits and return only
version, installation, authentication and safe error codes.

Codex keeps its existing tmux name and launcher. Claude has a disjoint tmux
namespace, so switching preserves two separate native conversations. A second
tab observing a provider change disconnects at renewal and can reconnect. Refresh
reattaches to the live pane. After a container restart Claude uses its documented
current-directory `--continue` when native transcripts exist. No Codex transcript
is imported into Claude. Ctrl+C interrupts; `/exit` stops the native CLI; reconnect
creates a new pane and resumes native history. Exit codes/signals propagate from
the CLI wrapper. Target deletion stops both providers and deletes target Claude
state while retaining other targets. No execution timeout is imposed on a
human-operated persistent terminal; Docker memory/PID limits remain applicable,
and at most eight Claude panes may be retained in a runner.

## Passive Burp MCP and Recon

Claude receives an isolated inline MCP configuration with `--strict-mcp-config`;
no global MCP files are edited. It uses the existing runner-side Burp bridge and
upstream endpoint configuration. The server exposes only `burp_status`,
`burp_history` and `burp_save_observation`, and rejects unadvertised active calls
on the server. History retains existing scope filtering, bounded reads and
redaction. The protocol diagnostic connects from the runner to the configured
upstream. A configured bridge is not evidence of upstream availability.

Claude can read the same `scope.md`, `recon/hosts.json` and exported Recon files.
The existing pipeline refreshes inventory on ticket renewal. Trusted invocation
instructions mark all Recon/HTTP/MCP content as untrusted data. Native permission
prompts remain enabled. Bash, browser and agent execution tools are not exposed
by this launcher. Native Edit/Write support recording redacted notes and
hypotheses for the existing human review workflow.

## Skills and limitations

Existing Codex skills are installed by the unchanged Docker stage from
`sickn33/agentic-awesome-skills` revision
`b7f6ad814a903f912962ea3cccad8c02766f753b`, with checksums and upstream licenses:
`web-security-testing`, `api-fuzzing-bug-bounty`, `idor-testing`, and
`ffuf-web-fuzzing`. They are **not installed for Claude**. No Claude skill-loading
or active-testing parity is claimed.

Native interactive output is streamed intact, without fragile text parsing or
an invented cross-provider event format. Model, quota and inference errors are
shown by the native CLI. The runner's shared Unix account remains the existing
operator trust boundary: separate configuration directories and conversation
names are not OS isolation between hostile users. Use separate runner instances
for mutually untrusted operators. Provider selection records the current engine;
native CLI history remains the conversation store, rather than new database
conversation records.

Official references consulted:
- [CLI flags, authentication status and continuation](https://code.claude.com/docs/en/cli-reference)
- [MCP configuration](https://code.claude.com/docs/en/mcp)
- [Settings and permission precedence](https://code.claude.com/docs/en/settings)

## Files changed

- Contracts and persistence: `src/lib/research/provider.ts`,
  `src/lib/research/terminal.ts`, `prisma/schema.prisma`, additive migration
  `20261028160000_research_provider`, `src/server/research/sessions.ts`,
  `src/server/research/terminalTicket.ts`.
- Web: `src/components/ResearchTerminal.tsx` and
  `src/app/api/research-targets/[id]/terminal/route.ts`.
- Runner: `docker/research/console/providers.mjs`, `console/server.mjs`,
  `console/stop.mjs`, `validator/claude-config.mjs`, `validator/claude-launch.mjs`,
  `validator/interactive-process.mjs`, `validator/console-burp-main.mjs`,
  `bughunter-claude`, `bughunter-burp-passive-mcp`, `console-entrypoint`,
  `Dockerfile`, and `docker-compose.yml`.
- Tests: `tests/unit/researchProviders.test.ts`,
  `tests/integration/researchConsole.test.ts`, `tests/migrations/programUpgrade.mjs`,
  `tests/research/runConsole.mjs`, and `tests/research/portSwiggerAcceptance.mjs`.

The pre-existing provider diagnostics files and their original changes to the
terminal/service remain outside this commit. Release images were also built
from the staged snapshot, ensuring they do not require those local changes.

## Validation, 2026-10-28

| Check | Result |
| --- | --- |
| `npm ci` | Passed |
| `npm audit` | Zero vulnerabilities |
| `npx prisma validate` / `generate` | Passed |
| `npm run lint` / `typecheck` / `build` | Passed |
| `npm test` | 46 files / 559 tests passed; 10 files / 146 tests skipped |
| Previous default baseline | 45 files / 549 tests passed; 10 files / 145 tests skipped |
| `npm run test:queue` | 55 files / 699 tests passed; 1 file / 6 tests skipped; additive migration passed |
| `npm run test:network` | All 6 local HTTP tests passed |
| Research SSH infrastructure suite | Passed with real Codex, local SSE/stdio fixture and isolated volumes |
| Web and Research Docker builds | Passed, including images from staged source only |
| Console browser/PTY suite | Passed with real Codex and Claude binaries, selection, persistence, reconnect, missing authentication, interruption, target cleanup and container restart |
| Native Claude MCP loading | Real CLI structured initialization discovers the configured passive bridge and tools; missing-auth inference fails; probe does not persist a conversation |
| Real Burp acceptance | Passed with isolated Burp Community, native Codex MCP, local HTTP fixtures, disconnect/reconnect and Claude passive relay status/history |
| Existing Codex skills | All four discovered by native Codex; checksums verified |
| Authenticated Claude inference, quota/model access, transcript continuation with real model history | Not validated: no Claude credentials supplied to disposable containers |
| Claude security skills | Not installed or validated |

A repeat infrastructure run during simultaneous image builds exceeded existing
Redis/database test timeouts. Its subsequent run passed without changing those
timeouts. The first expanded browser run reused a fixture whose scope had been
revoked earlier; the restart assertion was corrected to use the still-authorized
fixture and the complete suite then passed. A later repeat exposed Burp tool
inventory recovering before history became readable after restart; the acceptance
test now polls only the passive history readiness read with a bound. Active target
calls are never replayed. No scope protection was relaxed.

The `deepmerge-ts` override remains 8.0.2; application dependency manifests and
lockfile are unchanged. Claude's exact-version npm package has no runtime
JavaScript dependencies and pins its platform packages to the same version.

Regressions to monitor: paired web/runner deployments, CLI flag/auth schema changes
when deliberately upgrading the pinned version, native history format/path
changes, and the existing shared Unix operator boundary. This implementation does
not claim full active-provider parity.
