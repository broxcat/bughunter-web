# Burp MCP persistence in Research

## Cause and evidence

Before the fix, `burp` used `network_mode: service:research-console` and depended
on Research health. The running Burp container (healthy, created four hours
earlier) referenced `container:9e76f40d2d39931a6bd0e9127d7c63618126864e33e6d66ec964590f3f77c3f3`.
Research had been recreated two hours earlier. Its loopback MCP probe returned
`unavailable` despite the healthy Burp process. Docker network namespace sharing
pins a container identity; it does not make loopback follow a recreated service.
No database migration was involved.

Both CLIs already had persistent volumes and ran as UID 1000 (`researcher`).
Codex receives managed per-workspace overrides from installed launchers and
app-server RPC. Claude already had an isolated passive gateway; merely finding
its three static tool definitions could incorrectly suggest Burp was available.

## Network and startup

Burp now owns an independent network namespace. `burp-private` is a DNS alias
on the internal `burp_link` network, shared only with Research. Burp retains its
loopback extension (9876) and proxy (8080). `forward.py` binds 9877/8081 only to
the private interface. No Burp ports are published to the host. Research's local
TCP relay connects to that alias afresh for each connection and preserves the
localhost HTTP Host required by Burp's origin protection. Neither relay stores a
container IP. Burp retains egress for its existing proxy functionality.

Research starts with no wait for Burp. Socket connection attempts time out in
three seconds. MCP operations retain bounded timeouts. The official scoped relay
retries discovery in the background with progressive delay capped at 15 seconds
and emits tool-list changes. Active requests are never automatically replayed.
The passive gateway creates a fresh SSE connection per operation, so an existing
client can recover after Burp restarts. The Burp entrypoint supervises its TCP
forwarder as well as its JVM. Research health remains independent of Burp health.

`BURP_SERVICE_HOST=burp-private` enables the local relay in Compose. For the
existing external SSH bridge deployment, set `BURP_SERVICE_HOST=` to leave the
local ports free for SSH forwarding. Existing `BURP_MCP_HOST/PORT` and
`BURP_PROXY_HOST/PORT` operator settings remain supported. Startup records only
these non-secret transport settings in a root-owned readable file under
`/etc/bughunter`, so CLI environment filtering cannot discard them.

## Native CLI configuration

Codex keeps `/home/researcher/.codex` and existing workspace configuration.
`consoleMcpOverrides` injects the managed `burp` entry on every launch and native
app-server probe, overriding stale managed entries without rewriting user MCP
entries, credentials or transcripts. The existing `bughunter_burp` gateway stays
in the immutable workspace configuration. Native discovery now waits a bounded
window for asynchronous Java relay startup. Context trust and scope controls
remain unchanged.

Claude keeps `CLAUDE_CONFIG_DIR=/home/researcher/.claude/workspaces/<context>`.
Startup reconciles a dedicated `bughunter-mcp.json` for each existing context;
the launcher also reconciles it for newly created contexts. Writes are atomic,
mode 0600, idempotent and reject symlinks or unexpected owners. User settings,
credentials, MCP files and transcripts are never rewritten. The native
`--strict-mcp-config --mcp-config <file>` invocation loads this file alone under
the existing restrictions; other user MCP servers remain stored without being
activated by Research. Native `--continue` behavior is preserved. Only the three
passive tools are exposed, with default permissions and no global bypass.

## Observability

The console probes the selected provider's actual native MCP discovery (Codex
app-server; Claude streaming control protocol). `connected` requires discovered
`burp_status` plus a live upstream initialize/listTools handshake. A missing
entry reports `not configured`; failed discovery or transport reports
`unavailable`. Before a probe finishes the existing console shows `starting`.
A static local tool list is insufficient. These checks send no prompt to a
model, no target traffic, and no raw account information to the frontend.
Burp uses a private unauthenticated listener: a transport/discovery failure is
reported as such, rather than claiming it is a model-account login failure.

## Validation

Run `npm run test:research:mcp-rebuild` against the existing Compose services.
Optionally set `RESEARCH_MCP_TEST_WORKSPACE=/workspaces/research_<id>`; otherwise
the script chooses an existing context. Burp must already be configured and its
terms accepted. This test uses the real Burp extension and installed CLI versions
(Codex 0.165.0, Claude Code 2.1.312), no mock or model inference.

The acceptance test checks native tool discovery for both providers, rebuilds
Research, force-recreates only Research, verifies Burp's container ID is unchanged,
stops Burp and observes failure on an already open MCP client, starts Burp and
waits for bounded health readiness, verifies recovery on the same client, then
restarts Research again and repeats native discovery. Hashes of preexisting
authentication files, user settings and native JSONL transcripts must match.
No volumes are removed, databases reset, or migrations run.

Unit regression tests cover idempotence, file recreation, native CLI file
selection, configuration/session preservation, deletion isolation, symlink
rejection, deterministic Codex overrides, and independent Compose topology.
The general suite also retains its scope/transport/reconnection tests.

Validated on 2026-10-28: real Docker acceptance passed, full executable Vitest
suite (563 passed, 146 skipped), lint, typecheck, Next.js build, Research/Burp Docker builds, npm audit
(zero vulnerabilities). Infrastructure-dependent tests skipped by the normal
Vitest configuration are not claimed as executed. No Prisma schema changed.
Native sessions are preserved on disk; live tmux processes end when their
container is recreated and the existing launchers resume the native histories.
The test does not claim a billed model request or active target operation.

Upstream references: [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/)
and [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp).
