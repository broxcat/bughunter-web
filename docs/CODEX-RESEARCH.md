# Per-target Codex Research console

> **Retired.** The Research console (Codex/Claude terminals, Burp bridge and their containers) has been removed from BugHunter. Research is now done manually in a local CLI. This page is kept for history only; see [Research console removal](research-console-removal.md).

`/research` lists authorized concrete technical Targets. **Open console** navigates
to `/research/<Target.id>` and opens Codex directly in a full-screen xterm.js
terminal, with only a host/UA/status/reconnect bar. It does not inherit dashboard
navigation or expose email, UUID cards, SSH instructions, ZIP or hypothesis counters.

One Target = `/workspaces/research_<Target.id>` = `bughunter-<Target.id>` tmux
session. Browser refresh/reconnect detaches and reattaches; it does not terminate
Codex. A container restart loses tmux but retains files and the dedicated Codex
home. On restart the wrapper queries the official local app-server `thread/list`
with an exact CWD filter and resumes that interactive thread, if present. Otherwise
it starts with an original BugHunter bootstrap based on the workspace. No
conversation state is fabricated/stored in PostgreSQL.

## Architecture and authentication

```text
browser -- Auth.js --> web: authorize Target + create/reuse workspace
browser <-- 30-second Ed25519 ticket (no cookie forwarded to terminal)
browser -- same-origin WSS /research-terminal/<targetId> --> Tailscale Serve
             --> cookie-stripping ingress proxy --> research-console:7681
             --> real node-pty --> tmux --> bughunter-codex
web -- dedicated host Research bind mount --> /workspaces/research_<targetId>
research-console -- Research egress --> Codex / authorized target
research-console -- local reverse SSH bridge --> host Burp Proxy + MCP
```

The terminal URL contains a Target ID, never a session UUID or filesystem path.
Server-side admission checks authentication, owned Target/program/scope, active
membership, APPROVED authorization, exact host matching, exclusions and required
User-Agent. Policy identity/version must still match the exported snapshot.
A strict, signed 30-second ticket (single-use within the running service) binds user/Target/session and the
policy hash. It travels in the WebSocket subprotocol header, not a URL/log. A small unprivileged
NGINX ingress proxy forwards only necessary WebSocket headers and strips browser
cookies/Authorization before Research; the terminal rejects those headers if they
arrive by mistake. Exact Origin is checked. The web alone mounts the Ed25519 private
key; the console gets only its public verification key. No AUTH_SECRET/HMAC is
shared. The browser renews admission every 20 seconds; failure closes the PTY
attachment. It accepts only terminal input, bounded resize and signed renewal.
The initial command/name/CWD are fixed by installed code, not browser parameters.

Tmux remains alive when the browser is absent. **Revocation does not remotely
kill an unattended Codex session**: stop it as operator when authorization changes.
The runner has no live DB feed or per-target network firewall. All consoles use a
single trusted operator Unix identity and Codex account; this is not hostile
multi-tenant filesystem/process isolation. Application ownership checks protect
admission, not other workspaces from an already trusted YOLO shell operator.

The standard Compose service is permanent and starts without Burp or SSH keys.
No Docker socket, privileged mode, SYS_ADMIN, app env_file/source mount, database/
Redis URL/volumes, OAuth/AI/Auth.js credentials or host home is given to it.
Only Research root, dedicated Codex home/SSH host keys, optional public SSH keys
and terminal public key are mounted. SSH's master starts privileged and drops to
researcher; terminal Node, PTYs, Codex, Java and Chromium are non-root. Limited
sshd capabilities, no-new-privileges, PID/memory limits remain. The separate
`research_terminal` ingress network contains only console, the cookie-stripping proxy and Tailscale; DB/Redis
stay on backend, web/worker do not join console networks. No terminal host port is
published; only SSH is published on **127.0.0.1:2222** by default.

## Operator setup

Choose a static host directory and matching local UID/GID. Never derive it from
an application email/name. This deployment uses `/home/brokcat/bughunter-research`.

```sh
node scripts/setup-research-console.mjs --root /home/brokcat/bughunter-research
# .env (non-secret settings):
# RESEARCH_HOST_ROOT=/home/brokcat/bughunter-research
# RESEARCH_WORKSPACE_UID=1000
# RESEARCH_WORKSPACE_GID=1000
docker compose config --quiet
docker compose build
docker compose up -d db redis
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose run --rm --no-deps web npx prisma migrate status
docker compose up -d
```

The setup creates dedicated Ed25519 files under ignored `data/research-terminal/`
and an empty optional `data/research-ssh/` directory. Existing signing files are
verified, never silently rotated. Private signing files stay 0600; public files
contain no secret. Neither enters build context/Git. Public key setup and the
local service are separate from Codex/Burp authentication.

When using the existing Tailscale profile, recreate its sidecar after adding its
new `research_terminal` network. Existing Tailscale state is retained; no new auth
key is fabricated. Its Serve handler mounts `/research-terminal/` and proxies to
`http://research-terminal-proxy:8080/research-terminal/`: Tailscale strips its mount prefix,
so the upstream URL deliberately restores it. WebSocket upgrades stay under the
same browser-visible origin, with Funnel disabled. Other deployments must supply
equivalent same-origin authenticated ingress; do not publish 7681 on LAN/Internet.

Optional SSH (not required to open the browser console):

```sh
ssh-keygen -t ed25519 -f ~/.ssh/bughunter_research
install -m 0644 ~/.ssh/bughunter_research.pub data/research-ssh/authorized_keys
docker compose restart research-console
ssh -i ~/.ssh/bughunter_research -p 2222 researcher@127.0.0.1
codex login --device-auth
```

The private key remains outside the project. Root/password/keyboard login, local
TCP forwarding, agent/X11/Unix socket forwarding are disabled. Only remote listens
127.0.0.1:8080 and 127.0.0.1:9876 are allowed, GatewayPorts no. Container localhost
means the container, not Docker host. Codex login is explicit and persists only
in `research-codex`; no BugHunter key is copied. Browser TUI can also guide login.
The bar reports only signed in/login required, never a token or account dump.
A one-time UID upgrade can change ownership inside this dedicated Codex volume;
Research data and old UUID directories are never recursively chowned/renamed.

## Workspace

```text
research_<targetId>/
├── scope.md
├── recon/                    # actual exported Recon only; may be empty
├── requests/                 # minimal reproducible requests/captures
│   └── burp/                 # explicit redacted gateway observations
├── scripts/                  # target-specific PoCs, no generated attack catalogue
├── findings/                 # hypotheses, rejected paths, notes/reproduction drafts
├── .agents/bughunter/        # policy/target/session metadata, rules, bootstrap
└── .codex/config.toml         # deterministic project MCP/instructions
```

`source/` is optional; nothing downloads source automatically. When authorized source is
provided, the host operator can create this fixed subdirectory with matching UID/GID
(e.g. `docker compose exec -u root research-console install -d -o researcher -g research -m 2770 /workspaces/research_<targetId>/source`), then copy only the provided code. Required public
directories exist even without Recon. Scope includes program, Target ID, exact
host/scheme/port, exclusions, rules, qualifying/non-qualifying policy, UA,
authorization provenance/date and stop/cross-host-redirect rules. Discovery never
grants authorization. Export DTOs never contain target credentials/ciphertexts,
AI keys or app secrets; authentication in Burp is the operator's explicit choice.
Recon URLs are filtered to the exact selected host and carry ScanRun provenance.

The web publishes a complete temporary directory by atomic rename. SQL uniqueness
on nullable ResearchSession.consoleTargetId and Target row locking serialize first
creation/reconnect. Paths use only validated server-owned Target IDs under a fixed
root; symlinks and traversal are refused. Critical inputs are web-owned/read-only;
requests/scripts/findings have the configured operator UID/GID and group-write
permissions, never chmod 777. Actual newly created Codex files use that UID.
Immutable input ownership is intentional; it does not prevent host-root or a
trusted YOLO process from bypassing the gateway via other tools.

## Codex and installed skills

Official npm stable verified during this implementation: **Codex 0.165.0**.
Pinned image build and infrastructure run `codex --version` and
`codex --yolo --help`. --yolo is the actual alias of
--dangerously-bypass-approvals-and-sandbox, not a restricted full-auto mode.
`bughunter-codex` launches it directly, never an initial empty shell. First launch
gets the bootstrap; subsequent launch uses an exact-CWD native resume when found.
Project `.codex/config.toml` contains optional Burp and Playwright MCP and research
instructions. The installed wrapper supplies explicit trust for this generated
project only; it does not rewrite global user config per host.

Four complete immutable skills, including their supporting files, come from
`sickn33/agentic-awesome-skills` at
`b7f6ad814a903f912962ea3cccad8c02766f753b`:
web-security-testing, api-fuzzing-bug-bounty, idor-testing, ffuf-web-fuzzing.
They live at `/etc/codex/skills/`, an officially supported admin discovery path.
Build checks SKILL.md and a SHA-256 manifest; tests query native `skills/list`.
Their mandatory authorization/command confirmation gates are unchanged. YOLO
never means stripping those rules. Choose a relevant skill rather than running
all of them; missing optional tools referenced by a skill are not auto-installed.
Use the [Research harness](RESEARCH-HYPOTHESES.md#research-harness) to map observations, plan a specific test and review recorded evidence. The native console provides the existing scoped MCP tools for operator-approved work.

Useful TUI commands after operator login: `/status`, `/mcp`, `/skills`.
Remote inference and signed-in TUI checks require an operator Codex account; tests
never fabricate login credentials. Native config/skills/protocol discovery and
the unauthenticated TUI are independently testable without model access.

## Notes, history and Findings

The primary journal is findings/ and reproducible requests/. The optional v2 JSON
registry still syncs manually via the owned ResearchSession API, now reading
findings/hypotheses.json for console workspaces. No watcher or Markdown parser.
[RESEARCH-HYPOTHESES.md](RESEARCH-HYPOTHESES.md) explains the unchanged review gate.
A CONFIRMED hypothesis is not a Finding; explicit human draft promotion,
Evidence Review and Report creation remain separate. Manual Findings still work.

Old UUID sessions keep their data, immutable ZIP and APIs. The deprecated legacy
POST exporter remains an archival compatibility API; it never allocates a terminal
or another logical Target console. Their UI lives at
`/research/history/<sessionId>`; old session bookmarks redirect there. Old nested
hypothesis bookmarks redirect too. No directory is silently renamed or backfilled.
Hunt remains history only (new HUNT returns 410); Recon stays a ScanRun and
Research stays a separate session. Old runner storage is mounted separately at
/legacy-workspaces; the application keeps its original volume at /research-workspaces.

## Policy changes and troubleshooting

Scope/UA are snapshots, not a live policy feed. Policy drift refuses new admission.
After changing a program/scope, explicitly stop this Target's tmux process before
refreshing protected inputs; mutable notes/captures and old Recon are retained:

```sh
docker compose exec -u researcher research-console tmux kill-session -t '=bughunter-<targetId>'
docker compose exec -T -e RESEARCH_CONFIRM_TMUX_STOPPED=yes web \
  npx tsx scripts/refresh-research-console-policy.mts '<targetId>'
# Reopen/reconnect the same Target console.
```

The operator acknowledgement is required; the CLI cannot attest that an external
Codex process is stopped. Never refresh to legitimize a revoked/excluded target;
current server scope validation still applies. The CLI accepts only a Target ID,
not a path/host/command/config, and refreshes fixed policy files only.

- Console unavailable: check signing file permissions, matching public key, container
  health and same-origin Tailscale route/network. Do not expose ports or skip tickets.
- Login required: independently authenticate Codex; do not import app/provider keys.
- Burp unavailable: normal terminal still works; see the [Burp guide](BURP-MCP-RESEARCH.md).
- Workspace exists without a DB row after a crash: fail closed, inspect as operator;
  never automatically overwrite or adopt an unverified directory.
- Unsafe/missing JSON: validator emits bounded field errors. Old workspaces remain
  readable; an invalid sync never fails the workspace or creates Findings.
- First startup without keys/root: run the setup helper. Burp/SSH/Codex login are optional;
  the dedicated terminal signing key/root configuration is mandatory.

## Verification

```sh
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
git diff --check
docker compose config --quiet
npm run test:queue -- --research-browser
npm run test:research
# Final locally configured image/DB; synthetic rows only, explicitly opted in:
docker compose exec -T -e BH_FINAL_STACK_SMOKE=1 web npm run test:research:final
```

From the Docker host, `npm run test:research:final` runs legacy preservation plus
the actual public-origin HTTPS/WSS console smoke. It uses a disposable .test account
and refuses automatic remote inference if the operator Codex account is already
signed in. The container-only opt-in command above still runs legacy preservation.

The real-image console suite verifies auth/tickets, xterm/PTY/tmux refresh,
different Targets, revoked scope, official proxy SSE, UA at a local HTTP receiver,
Playwright through a local bridge, skills discovery and backend isolation. All
network fixtures are disposable/local. Burp reports PROTOCOL_VERIFIED, not a real
GUI test. The current staged process is documented in [Research harness](RESEARCH-HYPOTHESES.md#research-harness).
