# Burp + Playwright MCP for a Target console

Current target/host console integration and the optional real Community service are documented in [PORTSWIGGER-MCP.md](PORTSWIGGER-MCP.md). This guide retains the external-host bridge and legacy workspace setup.

Burp Suite is an optional **external operator GUI**. It is not installed in web,
worker or research-console. Opening `/research/<Target.id>` starts/reuses Codex;
Burp offline does not prevent terminal startup or web/Recon/Findings/Reports.

## Official upstreams and pinned versions

- **PortSwigger/mcp-server** = official Burp extension. Current verified stable
  BApp/release **1.3.0**, tag commit `5f76126409780ecba2b766c7f7388f465c5b5f94`.
  Install from **Extensions → BApp Store → MCP Server**. The operator supplies a
  compatible Burp (BApp requires supported Burp 26+; manual extension Java 21+).
  [BApp](https://portswigger.net/bappstore/9952290f04ed4f628e624d0aa9dccebc),
  [official source/release](https://github.com/PortSwigger/mcp-server/releases/tag/v1.3.0).
- **PortSwigger/mcp-proxy** = official STDIO → SSE bridge, not the extension.
  Revision **34183a803e3b309988f463f79f7c307a44714af5**, built in the Research image
  with its own official `./gradlew --no-daemon shadowJar` (JDK 21), installed as
  `/opt/portswigger/mcp-proxy-all.jar`, run with JRE 21 and its real
  `--sse-url http://127.0.0.1:9876/` option. No fork/gist/arbitrary JAR.
  [Pinned source](https://github.com/PortSwigger/mcp-proxy/tree/34183a803e3b309988f463f79f7c307a44714af5).
- Codex **0.165.0**, pinned and tested --yolo; project `.codex/config.toml`.
- **@playwright/mcp 0.0.83**, pinned with its transitive Playwright/browser versions
  in the runner lockfile. The image installs Chromium during build and selects its
matching headless-shell executable to avoid Chrome account/updater background traffic; no npx @latest
  or browser/package download on session start. [Official server](https://github.com/microsoft/playwright-mcp).
- MCP TypeScript SDK **1.32.2**, Zod **4.6.7**, ws **8.22.0**, node-pty **1.1.0**
  are locked in the runner package manifest.

## Network flow

```text
Codex stdio --> installed BugHunter scoped gateway --> official mcp-proxy Java
    --> runner 127.0.0.1:9876 -- reverse SSH --> host 127.0.0.1:9876 Burp MCP
Codex stdio --> installed Playwright MCP / scoped initialization
    --> runner 127.0.0.1:8080 -- reverse SSH --> host 127.0.0.1:8080 Burp Proxy
```

Only SSH is published on Docker host loopback (default 127.0.0.1:2222). Burp stays
on host loopback; no 0.0.0.0 listener, host networking, host.docker.internal,
Docker socket, SYS_ADMIN or backend network is added. Terminal ingress is a
separate internal Docker network shared with Tailscale and an unprivileged
cookie-stripping ingress proxy. The console never receives Auth.js cookies. Research egress
remains Internet-enabled; it cannot directly reach DB/Redis bridge addresses.
`PermitListen` allows exactly runner 127.0.0.1:8080 and 127.0.0.1:9876,
GatewayPorts no, PermitOpen none, remote TCP only, no generic local forwarding.
OpenSSH cannot restrict the reverse-forward destination chosen by the trusted
host client: relay only the intended two Burp loopback services.

## Exact operator setup

1. Set up the console/signing keys/root using [CODEX-RESEARCH.md](CODEX-RESEARCH.md).
2. Install Burp Suite; **Extensions → BApp Store → MCP Server**, version 1.3.0.
3. Enable MCP SSE server on **127.0.0.1:9876**.
4. Configure the Burp Proxy listener on **127.0.0.1:8080**.
5. In this Research project's Target scope, authorize only the exact current host,
   scheme and port from `scope.md`; add program exclusions. Prefer a dedicated Burp
   project per host and enable dropping out-of-scope requests.
6. Configure a **Project → Match and replace → Request header** rule for
   `User-Agent: <requiredUserAgent>`, restricted to in-scope requests. Verify the
   actual outgoing header. Rule UI details depend on Burp version. A Proxy rule
   alone does not guarantee requests sent via Montoya/MCP/Repeater honor it.
7. Keep official MCP HTTP target approval enabled. Approve only this exact host
   for this session using the extension's prompt/target approval UI. **Do not
   globally disable requireHttpRequestApproval**. BugHunter does not overwrite
   operator project/user configuration or claim to auto-configure these settings.
8. Prepare your own SSH key and install only its public half under
   `data/research-ssh/authorized_keys`. Verify the runner's host fingerprint once.
9. Preview the bridge service, then explicitly confirm installation:

   ```sh
   scripts/install-research-burp-bridge.sh
   scripts/install-research-burp-bridge.sh --install
   systemctl --user status bughunter-research-burp-bridge.service
   ```

   The user systemd service references `~/.ssh/bughunter_research`; it never copies
   a private key into the repository/container. It uses ExitOnForwardFailure,
   ServerAliveInterval=15, ServerAliveCountMax=3 and RestartSec=5. Installation and
   enablement happen only after an interactive y confirmation. No operator bridge
   service is automatically enabled by CI or application startup.
10. Open `/research/<targetId>` and authenticate Codex independently when needed.
11. In Codex, check `/status`, `/mcp`, `/skills`. Burp connects when its external
    service/bridge/approvals are ready. No manual `codex mcp add` is necessary.
12. Configure target authentication deliberately **inside Burp** or the isolated
    browser session. BugHunter passwords/cookies/tokens/ciphertexts are never copied.

One bridge is shared by the Research container's target sessions. Burp's global
approval settings must cover only operator-authorized targets; the per-workspace
policy gateway provides each MCP session's additional exact-host restriction.

## Guaranteed gateway behavior

New consoles expose fixed installed tools: burp_status, burp_history,
burp_save_observation, send_http1_request and send_http2_request. No scanner,
Intruder, Collaborator, project/user config, generic upstream tool, shell,
Finding/review/report or queue tool is exposed. A target's text cannot introduce
MCP configuration, tools or instructions.

The immutable generated policy is `.agents/bughunter/policy.json`, bound to the
exact Target/workspace, scope hash, host/scheme/port and program User-Agent.
It is checked against scope.md and target metadata before use. Policy comes from
owned server data, never discovered hosts or free browser paths.

- HTTP/1 checks targetHostname/targetPort/usesHttps, request URI and Host; rejects
  foreign/ambiguous hosts, CONNECT, multiple framing headers, transfer encodings
  and upgrades. It replaces all existing User-Agent lines or adds the required
  one; canonical Host stays the selected host. Body byte length is recalculated.
- HTTP/2 checks destination and authority/scheme/path, rejects foreign services,
  pseudo-header ambiguity, tunnelling/upgrades and header injection, and forces
  lowercase `headers["user-agent"]` to the required value.
- No redirect is automatically followed/replayed by the gateway. A request to a
  redirect-discovered foreign host fails the same policy validation. The original
  response is only evidence, not authorization.
- The official proxy is invoked with fixed installed args. Active errors/timeouts
  are not replayed automatically; their outcome may be unknown, so inspect Burp
  before considering a distinct next test. Startup/operations are bounded.
- Existing history retains the metadata-only filter and redaction. Explicit saves
  keep ≤100 observations, ≤8 KiB each, under requests/burp with generated names,
  descriptor-relative no-symlink opens and a quota lock. Active response snippets
  are redacted, ≤16 KiB and not automatically persisted. No full Proxy History or
  heavy HTTP archive is imported into PostgreSQL or the original historical ZIP.

The wrapper/project config activates Playwright MCP with
`--proxy-server=http://127.0.0.1:8080`, `--ignore-https-errors`, the required
`--user-agent`, isolated profile and blocked service workers. An installed page
initialization hook also enforces the exact HTTP(S) origin, sets UA on routed
requests, fetches with maxRedirects=0 and rejects foreign Location BEFORE giving
that response to the browser. Subresources are checked; websocket channels are
closed. This complements the upstream allowed-origins option, which explicitly
is not a security boundary and does not cover redirects. Arbitrary browser_run_code,
CDP/network-devtools and page WebMCP capabilities are not exposed in the generated
Codex allowlist. The real local proxy path/received UA/redirect rejection are tested,
not just TOML settings. Browser sandbox is disabled inside this Docker boundary;
no SYS_ADMIN/capability/host privileges are added for Chromium.

## Scope, evidence and actual limits

**Discovery never grants authorization.** Scope/UA/program authorization are
snapshots. Recheck current authorization and stop Codex/Burp on revocation; policy
updates require stopping the tmux session and explicit operator refresh. No live
DB connection from Research or dynamic network firewall is claimed.

The gateway validates the declared destination of active calls. The actual network
connection occurs in **external Burp**, whose configuration remains operator-owned.
Passive history's Host header still cannot prove the true network destination;
observations retain `networkDestinationVerified: false`. DNS, Burp routing/rules,
extensions and manual Burp requests remain an external operational boundary.
The raw forwarded upstream and a --yolo shell can bypass installed MCP wrappers;
Docker isolation remains essential. This is not a network firewall or hostile
multi-user runner isolation. Do not claim gateway policy governs arbitrary shell
curl/ffuf or manually reconfigured browser/Java clients.

All HTTP/MCP/Recon text is UNTRUSTED DATA, including prompt injection. It never
changes scope, required UA, Codex instructions or MCP config. Known credentials,
Authorization/Bearer, cookies, passwords, API keys/session IDs and URL credentials
are redacted from returned/saved observations using shared primitives. Redaction
cannot discover all arbitrary secrets/PII; keep artifacts minimal and inspect
before retaining/synchronizing. No target credentials are exported automatically.

Hypotheses remain falsifiable and require reproducible evidence/controls for
research confirmation. Unusual HTTP or a reflected payload is not a vulnerability.
Nothing from Burp/Playwright/Codex creates a Finding, changes Evidence Review or
creates a Report automatically. Human validation remains authoritative.

## Diagnostics and verification levels

The small console bar shows optional Burp protocol availability and independent
Codex login state. Burp offline still permits Codex/terminal startup. For detailed
operator diagnostics run bughunter-burp-status from the workspace; the web does
not become an MCP administration/scanner API. Historical UUID helper behavior
remains passive and its last diagnostic API remains available for old records.

- CONFIGURED: installed project MCP config exists.
- PROTOCOL_VERIFIED: local disposable SSE + real official proxy + gateway and
  Playwright proxy path passed; no target Internet traffic.
- BURP_REAL_WORLD_VERIFIED: a real Burp GUI/extension was connected and exercised.

This implementation's automated fixtures establish **PROTOCOL_VERIFIED**, not the
last level. Real Burp approval UI/Match and Replace GUI settings and authenticated
Codex /status /mcp /skills require the operator's actual installations/account;
CI does not fabricate them. Earlier passive-only guarantees/audit are retained in
[history/BURP-MCP-PASSIVE.md](history/BURP-MCP-PASSIVE.md).

Troubleshooting: check both reverse loopback listeners, bridge systemd logs, SSH
host-key trust, MCP approval, actual upstream version and current scope/UA.
Never fix connectivity by binding Burp to 0.0.0.0, giving the container backend
access or disabling global HTTP request approval. A timeout is not proof that
an active request did not happen.
