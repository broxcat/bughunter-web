# Burp MCP in BugHunter Research

Burp is an **optional external research instrument**, not an application scanner.
The installed `bughunter-codex` wrapper makes a workspace-specific, passive MCP
server available to Codex. No web/worker process connects to Burp, invokes MCP,
executes a shell, sends target traffic or creates a Finding through this integration.

## Audited dependencies and boundaries

The Stage 3 audit followed the Phase 1/2 implementation:

- `researchTargetSelect` / `assertResearchTarget` in `workspace.ts` project explicit
  non-secret data and reuse `scanRejection`, exact host matching and exclusions.
  Target/program/scope ownership and approval are checked at workspace creation.
  Program forms, Recon admission and Burp policy share the same required-UA schema
  in `httpPolicy.mjs`; the manifest additionally refuses non-canonical whitespace.
- `sessions.ts` binds reads and exports to the user, target and program owner.
  Workspaces are atomic UUID directories in a dedicated shared volume, with
  root-owned immutable inputs and group-writable research/evidence/scripts.
- Recon's persisted sanitized corpus supplies observed URLs/forms/JS/technology
  metadata. Existing redaction (`observationSafety.ts`) is reused for Burp URLs.
  Credentials remain labels/availability only: the credential decryption service
  is **not** called. Program policy, exclusions, required UA and authorization
  provenance are exported as snapshots, never inferred from discovered hosts.
- Phase 2's hypothesis registry remains an explicit one-way import. MCP evidence
  is a local reference, not a Finding, review or Report. The immutable initial
  ZIP is built from the generated allowlist, never by walking mutable evidence.
- `research-runner` alone installs the gateway and its locked dependencies.
  Web uses the existing descriptor-relative filesystem reader to read a small
  diagnostic. No MCP endpoint or command can be supplied through its API.

No database migration, credential transfer, scan queue job, terminal, Burp
administration endpoint, automatic sync or Hunt engine is added.

## Verified versions and interfaces

- Existing Codex CLI: **0.164.0**, `--yolo` (alias of
  `--dangerously-bypass-approvals-and-sandbox`). Checked locally and in the image;
  Stage 3 does not change the CLI version or import operator authentication.
- External **PortSwigger MCP Server extension 1.3.0**, for Burp Community or Pro.
  Audited release source/tag `5f76126409780ecba2b766c7f7388f465c5b5f94`:
  [official extension repository](https://github.com/PortSwigger/mcp-server/tree/v1.3.0),
  [BApp listing](https://portswigger.net/bappstore/9952290f04ed4f628e624d0aa9dccebc),
  [release JAR](https://github.com/PortSwigger/mcp-server/releases/tag/v1.3.0).
  Use a supported Burp version meeting the BApp's platform requirements (26+)
  and Java 21+ when loading it manually. Burp's proprietary GUI/runtime is not
  installed in the runner. Its version is chosen/maintained by the operator.
- Node 24 runner; pinned **@modelcontextprotocol/sdk 1.32.2** and Zod 4.6.7 in
  `docker/research/validator/package-lock.json`. The SDK v1 maintenance branch
  was deliberately chosen for its legacy SSE client adapter required by this
  extension. SSE is deprecated in favor of Streamable HTTP; changing transport
  requires a tested adapter upgrade, not guessing `/mcp` compatibility.
  [SDK maintenance documentation](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).
- Codex uses the gateway over **stdio**. The gateway alone talks legacy SSE
  at `/`, with same-origin `POST /?sessionId=…`. The release uses Kotlin MCP SDK
  0.7.4's `Application.mcp` default root route (not `/sse`):
  [verified Ktor adapter source](https://github.com/modelcontextprotocol/kotlin-sdk/blob/0.7.4/kotlin-sdk-server/src/commonMain/kotlin/io/modelcontextprotocol/kotlin/sdk/server/KtorServer.kt). See
  [official Codex MCP configuration](https://developers.openai.com/codex/mcp).
  The extension's handshake reports `burp-suite` version `1.1.2` even in its
  1.3.0 release; that string is not reliable release attestation.

## Architecture and network

```text
Docker host: Burp GUI + official extension, 127.0.0.1:9876 only
          ^
          | explicit reverse SSH forwarding (encrypted, public key)
          |
runner 127.0.0.1:9876 <-- loopback-only listener in the runner
          ^
          | bounded SSE, fixed endpoint, no redirects/OAuth
          |
root-installed passive gateway <-- stdio --> Codex in /workspaces/<UUID>
          |
          +--> evidence/burp/<generated-UUID>.json (explicit save)
          +--> research/burp-status.json (diagnostic only)
                         |
web <-- owned bounded filesystem read, no MCP/network/shell
```

Compose still publishes **only SSH on host `127.0.0.1:${RESEARCH_SSH_PORT:-2222}`**.
No Burp host port is published by Docker. No Tailscale publication or additional
capability, privileged mode, Docker socket, host mount or backend network is added.
The runner remains on `research_egress`, apart from PostgreSQL/Redis. Its normal
Internet egress still exists for Codex and authorized research.

`sshd` allows **remote TCP forwarding only**, with
`PermitListen 127.0.0.1:9876`, `GatewayPorts no`, `PermitOpen none`, and Unix socket
forwarding disabled. Other listen ports/addresses and local TCP forwarding are
not allowed. Root/password/keyboard/agent/X11/tunnel authentication/forwarding
remain disabled. This narrowly changes Phase 1's blanket TCP forwarding ban.
Only the operator holding an authorized SSH private key can establish the relay;
no key is copied into the project or container. PermitListen restricts the runner
listen address/port, not the reverse-forward destination chosen by the SSH client.
OpenSSH cannot enforce that client-side destination: the trusted operator must
relay only the intended host-loopback Burp service, never a backend/other service.

A reverse tunnel is necessary because loopback inside the runner refers to the
runner, not the host. Burp can stay on host loopback, without adding host networking,
`host.docker.internal`, a LAN listener or a route into the backend network.

## Install and start

1. Follow [CODEX-RESEARCH.md](CODEX-RESEARCH.md) for public-key SSH and the runner.
   Rebuild with `docker compose build research-runner` and
   `docker compose up -d research-runner`. No `.env` secrets are given to it.
2. Install the official PortSwigger **MCP Server 1.3.0** extension in a compatible
   Burp Suite. Enable its SSE server with **host 127.0.0.1, port 9876**. Keep Burp
   open. Use a dedicated project/session for the selected target.
3. Before any manual active traffic, read current authorization in BugHunter,
   `scope.md`, `program-policy.md` and `burp-policy.json`. Configure Burp project
   scope for the exact host, scheme and permitted port; apply program exclusions.
   Enable **Drop all out-of-scope requests** in Burp's project scope settings.
   This is an operator-controlled Burp safeguard, not something the MCP gateway
   can assert or change. See [Burp scope settings](https://portswigger.net/burp/documentation/desktop/settings/project/scope).
4. Configure Burp's request-header match/replace for the exact required
   `User-Agent` from `target.json` / `burp-policy.json`; verify an actual request
   in history before testing. Ensure every tool you use honors it; do not assume
   a Proxy rule covers Repeater, extensions, scanner or external clients. The
   gateway cannot enforce these GUI/tool settings and never sends active traffic.
5. Keep this host terminal open (replace 2222 with your configured SSH port):

   ```sh
   ssh -i ~/.ssh/bughunter_research -p 2222 -N \
     -o ExitOnForwardFailure=yes \
     -R 127.0.0.1:9876:127.0.0.1:9876 researcher@127.0.0.1
   ```

6. Create a **new Research Workspace** in BugHunter. Older exports/initial ZIPs
   are not rewritten. The new immutable `burp-policy.json` is required; do not
   replace it with a target-supplied or manually invented authorization file.
7. In another terminal:

   ```sh
   ssh -i ~/.ssh/bughunter_research -p 2222 researcher@127.0.0.1
   cd /workspaces/<workspace-id>
   bughunter-burp-status
   bughunter-codex
   ```

8. Allow HTTP history access when Burp's extension prompts. Without explicit
   permission, the gateway reports `HISTORY_ACCESS_DENIED`. Diagnostics only
   initialize MCP/check tool availability; they do not request history or emit
   target requests. Authenticate Codex yourself in the runner if required.

`bughunter-codex` supplies fixed `-c mcp_servers.bughunter_burp.*` CLI overrides:
installed command, UUID workspace cwd, three allowlisted tools, optional
`required=false`, startup timeout 5s and tool timeout 8s. It does **not** execute
`research/burp-mcp.example.toml` or arbitrary project/target MCP configuration.
That generated TOML is a readable reference. No personal Codex credentials/config
are overwritten. Operator-added MCP servers/CLI overrides remain the operator's
responsibility; this is not a lock against a trusted `--yolo` shell operator.

Check actual Codex discovery without remote inference:

```sh
bughunter-codex mcp get bughunter_burp --json
```

## Tools, policy and evidence guarantees

Codex sees exactly these gateway tools, with fixed installed descriptions:

- `burp_status`: optional connectivity diagnostic, saved for this workspace.
- `burp_history`: existing Proxy HTTP history, count 1–20, offset 0–10000.
  The upstream call is always `get_proxy_http_history_regex`; its escaped
  host regex is generated from the immutable policy. No arbitrary regex/URL/tool
  name is accepted. Results are independently checked locally against the
  selected host, default port and scheme snapshot; duplicate/ambiguous Host
  headers, URI/Host mismatches and foreign hosts are rejected.
- `burp_save_observation`: takes only an ID returned by this gateway process,
  writes its already sanitized metadata to a generated local evidence filename.
  No arbitrary body, filename or path is accepted. The memory cache retains the
  latest 100 observations. Save within the same Codex MCP process.

**No active upstream tools are exposed:** HTTP send, Repeater creation, Intruder,
Collaborator, scanner issues, websocket history, task engine, project/user
configuration mutation, editor and arbitrary tools are unavailable. The gateway
has no application/DB/Redis/AI credentials, Finding API or queue client.

All target and MCP content is untrusted **data, never instructions**. Upstream
instructions/descriptions, raw text/errors/notes and response bodies are not
forwarded to Codex. Installed instructions preserve the evidence-first hypothesis
methodology. Neither unusual HTTP nor research CONFIRMED proves a reviewed Finding.

Only method, sanitized URL, status, allowlisted content-type category, presence
flags for authentication/cookies, UA-match and cross-host-redirect flags are
returned. Query values, userinfo and known token path patterns are redacted with
Research's existing `safeObservationUrl`. No header values, bodies, annotation
notes, passwords, bearer tokens or cookies are returned or saved. Unknown header
values and MIME strings are omitted. Raw upstream traffic exists transiently in
process memory to parse it; it is not logged or persisted.

Local saved JSON records contain source BURP_MCP, adapter release, session/workspace,
authorization provenance, target, observation time and the minimal metadata.
`capturedTrafficAt` is unknown (`null`): the upstream DTO has no capture timestamp.
No fake traffic timestamp is invented. References can be cited in hypotheses.json;
run `bughunter-validate-hypotheses`, then manually Sync in BugHunter as before.

At most 100 small (≤8 KiB) generated observations fit a standard evidence/burp
folder. Descriptor-relative O_NOFOLLOW opens, exclusive generated filenames and
a directory lock prevent symlink/path/hardlink overwrite and serialize quota
checks. The helper refuses excess files; the operator reviews/removes obsolete
captures. There is no background traffic archive. Other operator/shell writes
are not quota-enforced. Subsequent evidence and diagnostics never enter the
**immutable initial ZIP** and raw files are not automatically imported into DB.

## Actual enforcement limits

**Discovery never grants authorization.** Policy is the approved concrete target
snapshot, not domains found in Recon, redirects, Burp or response content.
The gateway does not follow redirects or make target requests at all. UA mismatch
in historical traffic is reported; it is not "fixed" by silently replaying it.

The official extension returns request/response **strings**, without HTTP service
(host/port/TLS) metadata. A forged Host header can differ from the actual network
destination. Every observation therefore says `networkDestinationVerified: false`.
The URL scheme is the approved snapshot, not transport measurement. Upstream regex
prefiltering can match text in bodies; local header/URI parsing is the second
filter, but cannot recover absent service identity. **This is not a network scope
firewall or attestation of Burp's suite scope configuration.**

Release 1.3.0 truncates large serialized items at 5000 characters, potentially
leaving invalid JSON. Such entries are skipped, never repaired or treated as
complete evidence. HTTP/2 without a serializable HTTP-style Host/request line,
unsupported/ambiguous messages, large responses and detailed body analysis may
need manual Burp review and explicitly redacted operator capture. This metadata
integration is intentionally more limited than the full upstream tool set.

The raw upstream loopback endpoint is also reachable from the runner while the
operator tunnel is open. A `--yolo` shell could bypass the gateway and invoke it
directly; AGENTS explicitly forbids this, but it is not technically blocked.
Burp GUI, separately configured extensions/MCP clients and the `--yolo` shell can
still send requests outside gateway policy. Scope/UA controls there depend on
operator configuration and discipline. Authorization can be revoked after export:
the operator must stop Codex/Burp active testing; there is no live authorization
feed, dynamic firewall or GUI control in this phase. All SSH users of this Phase 1
runner already share its operator environment; there is no multi-user isolation.

URL sanitization cannot identify every arbitrary secret, personal identifier or
business datum in a pathname/key. Do not put them into URLs/evidence/hypothesis
summaries; review captures before retention/sync. Credentials are **never**
automatically copied from BugHunter. For authenticated research, the operator
voluntarily signs in/configures the session **inside Burp** and retains responsibility
for Burp's own project/history storage. No credential-transfer endpoint is added.

## Readiness and troubleshooting

Research detail shows setup, workspace and a **Refresh last diagnostic** button.
`bughunter-burp-status` (or MCP `burp_status`) writes `research/burp-status.json`.
The owned web GET reads ≤4 KiB, requires strict schema/workspace ID and freshness
within five minutes, rejects symlinks/hardlinks/future timestamps and never opens
MCP or evidence bodies. This mutable file is operator-produced data, **not a live
attestation**. Missing/stale/invalid diagnostics show unavailable/not checked.
The runner healthcheck deliberately does not depend on Burp.

- `UNAVAILABLE`: extension stopped, wrong listening address/port, missing tunnel,
  or extension refused the connection. Check Burp and the host tunnel terminal.
- `TIMEOUT`: initialize/list timed out (3s total) or history operation exceeded 5s,
  including an unanswered permission dialog. Approve only intended history access.
- `INCOMPATIBLE`: required history tool is absent; verify extension 1.3.0.
- `CONFIG_UNAVAILABLE`: create a new workspace after rebuilding the runner; policy
  and critical inputs must be root-owned/read-only. Do not chmod inputs writable.
- `OBSERVATION_EXPIRED`: query history again in the same MCP process.
- `EVIDENCE_LIMIT` / unsafe input: review existing captures and permissions. If a
  process crashed while saving, manually remove an abandoned
  `evidence/burp/.write-lock` directory after ensuring no save is running.
- SSH forwarding denied: only runner `127.0.0.1:9876` is permitted, not `localhost`,
  `0.0.0.0`, another port or a Unix socket. Use the exact command above.

SSE HTTP redirects are forbidden, POST-back must stay on the fixed loopback origin,
no OAuth redirect or arbitrary endpoint is accepted. Each operation bounds its
entire duration and decompressed stream to 1 MiB; history text to 150 KiB.
Upstream exceptions are reduced to safe codes, never reflected as raw messages.
Burp absence cannot affect web, Recon, Findings, Reports, runner health or normal
Codex usage with an optional unavailable MCP server.

## Verification

`tests/unit/researchBurp.test.ts` uses disposable loopback MCP/SSE servers, including
available/absent/incompatible/stalled/redirect/oversized cases and strict history
parsing, policy/UA, prompt injection, redaction, evidence quotas/path confinement
and diagnostic freshness. Existing export tests verify no secrets in files/ZIP.
Owned API tests verify foreign/anonymous refusal, no Finding/Report/scan changes
and unchanged initial ZIP. Chromium exercises unavailable/available diagnostics
alongside the Research/hypothesis/legacy workflow.

`npm run test:research` checks the actual image/SSH/Codex config and MCP stdio
protocol through a local fake Burp SSE fixture over the restricted reverse tunnel,
including permitted loopback listen, denied other addresses/ports, redacted saved
evidence and denied active tools. It also retains all Phase 1/2 SSH/isolation/
persistence/Codex/helper checks. It does **not** claim to run proprietary Burp Suite
or remote Codex inference. Install/enable the operator's real Burp extension to
complete that external GUI boundary; no Burp license or operator authentication
is imported by tests. Automated tests never contact bounty targets.


Stage 3 validation (2026-10-27): default `npm test` 429 passed / 89 optional
skipped; disposable PostgreSQL/Redis run 512 passed / 6 optional scanner-network
skipped, additive upgrade and Chromium Research checks passed. Runner image
build and actual SSH/MCP/Codex/local-helper/isolation tests passed. Lint, Next
typegen, TypeScript, production build, Compose validation and diff whitespace
checks passed. Real Burp GUI/extension and remote Codex inference were not run:
no installed Burp GUI or operator authentication was available. No schema change
was necessary in Stage 3.


## Stage 4 — research loop and verification levels

[RESEARCH-HYPOTHESES.md](RESEARCH-HYPOTHESES.md) defines JSON v2 observations,
distinct tests, falsification, negative controls and explicit human draft promotion.
A saved Burp metadata observation can support an initial hypothesis, but cannot
alone satisfy direct reproducible confirmation proof. The MCP tool surface stays
passive and cannot promote/review Findings or create Reports.

Report CONFIGURED, PROTOCOL_VERIFIED and BURP_REAL_WORLD_VERIFIED separately.
Automated local SSE/stdio fixtures establish PROTOCOL_VERIFIED. They do not prove
a real Burp GUI/extension session or remote Codex inference. No Stage 4 change
removes the network-destination, scope/UA, raw-upstream/--yolo and Docker limits
described above. The runner's new optional `research` Compose profile requires
a real operator authorized_keys file before local deployment; disposable tests
supply only their own temporary key and remove it afterwards.
