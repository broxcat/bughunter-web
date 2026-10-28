# PortSwigger MCP in the target and host consoles

## Diagnosis

Before this change the Codex project configuration declared only `bughunter_burp`.
Its three program-console tools were `burp_status`, `burp_history` and
`burp_save_observation`. They are a BugHunter policy/evidence bridge, not the
PortSwigger inventory. Their stdio connection succeeds independently of Burp.
The history tool did use a real upstream when one was available; it was not a
replacement for installing Burp. Host consoles additionally exposed guarded
HTTP/1 and HTTP/2 wrappers.

The terminal banner separately launched the official Java stdio proxy against
`127.0.0.1:9876`. All failures, including an incompatible/empty inventory, became
`unavailable`. Reconnect merely reattached tmux. In the audited deployment Java
and the proxy JAR existed, but there was no Burp installation/process, no loaded
extension and no listener on 8080 or 9876, either on the host or in the console.
An optional reverse SSH bridge expected an externally started Burp.

## Architecture and boundaries

```text
Codex burp server → scoped stdio relay → official Java mcp-proxy-all.jar
                                               ↓ SSE, loopback :9876
Playwright → loopback HTTP proxy :8080 → Burp Community + official MCP extension
```

`bughunter_burp` remains separately named for diagnostics/saved observations.
`burp` exposes the actual upstream names and JSON schemas, discovered through
`initialize` and paginated `tools/list`. There is no synthetic PortSwigger tool
inventory and no fixed required count. The fingerprint requires HTTP history,
regex history, HTTP/1, HTTP/2 and Repeater capabilities. Missing optional
Professional capabilities do not make Community unhealthy. An upstream local
`url_encode` call also checks liveness when available: the Java proxy caches
schemas, so its cached `tools/list` alone cannot detect a lost SSE connection.
No target request is sent by this diagnostic.

The relay preserves the authorization snapshot and existing strict request
validators. Program consoles allow scoped existing-history reads and bounded
local utilities only. Host HTTP/1, HTTP/2 and Repeater calls require the exact
approved host, scheme and port, respect exclusions and impose the required
User-Agent. Failed active calls are never replayed automatically. Unknown/global
mutations, Intruder, editor/configuration access and tools without attributable
scope are denied before upstream invocation. Discovery never grants permission.

Proxy and Organizer HTTP reads fetch a bounded page, independently filter hosts
against the target rules/exclusions, and return redacted metadata, never global
raw traffic, bodies, cookies or Burp notes. The official regex-named tools keep
their original schemas but the gateway treats `regex` as a **literal filter on
already redacted metadata**, avoiding user-controlled regex execution in Burp.
Pagination may return an empty authorized page even when later pages contain
matching traffic. The upstream history format does not prove network destination
or scheme; the latter is the authorization snapshot, explicitly labelled.

The official 1.3.0 WebSocket history serialization contains payload/direction but
no host attribution. Those tools are visible in the real inventory but blocked
by policy. Scanner/Collaborator and global settings are likewise not granted by
the current host/program authorization model. This is not unrestricted access
to all 24 operations. A `connected` banner means core protocol availability,
not permission for every advertised operation or permission to scan a program.

Codex still has its existing `--yolo` shell. The MCP relay is an enforced boundary
for its own calls, not a system-wide network sandbox for arbitrary shell code.
The dedicated Burp namespace must remain local and controlled. Burp manual GUI
traffic or external clients require their own authorization and UA configuration.

## Dedicated Docker service

The optional `burp` profile builds only the official PortSwigger extension and
Burp binary. No third-party Burp image, emulated MCP or runtime download is used.
It shares `research-console`'s **network namespace**, not its PID namespace.
Burp listens on loopback only; Compose publishes neither 8080 nor 9876 and
provides no remote desktop. The web/worker cannot reach those loopback listeners.
Target deletion cannot see/kill the shared Burp JVM and never removes its volume.

After reviewing [PortSwigger's terms](https://portswigger.net/burp/eula), set
`BURP_ACCEPT_TERMS=yes` in the local `.env`, then:

```sh
docker compose build research-console web
docker compose --profile burp build burp
docker compose --profile burp up -d research-console burp web
```

Recreate `burp` when recreating `research-console`, since its network namespace
changes. A normal console process restart preserves its namespace. The named
`burp-home` volume stores local settings/CA identity. Community uses an in-memory
project: captured traffic does **not** survive a Burp restart. No Professional
licence is assumed, installed or purchased.

A fixed Xvfb display runs the genuine Community GUI privately. The pinned startup
helper selects the temporary project, loads the official extension and configures
HTTP/Organizer history access. HTTP request approval is delegated to the scoped
relay; config editing stays disabled, credentials filtering stays enabled, and
unattributable WebSocket reads stay disabled. Bootstrap coordinates are tied to
the pinned Burp release and must be revalidated on upgrade. Setup failure leaves
the container unhealthy; it must not be reported as MCP connected.

External Burp + the existing restricted reverse SSH bridge remains supported;
do not start the dedicated profile on ports already forwarded by that bridge.
`BURP_MCP_HOST`/`BURP_MCP_PORT` and `BURP_PROXY_HOST`/`BURP_PROXY_PORT` are
operator-side console configuration (defaults 127.0.0.1:9876 / :8080). Overrides
are for a separately configured private Burp, not automatic changes to the pinned
service's listeners. Never publish MCP publicly or put credentials in these
variables. They are never accepted from a browser request or target.

## Versions and provenance

| Component | Pinned/tested value |
| --- | --- |
| Burp | Community 2026.10.1, official desktop JAR |
| Burp JAR SHA-256 | `e8ab086537b1643b91ca09d2fc2a6c3e08a8bae0c85280797c5c9ec76506c3c5` |
| Official MCP extension | 1.3.0, `PortSwigger/mcp-server@ff10ffe6df163fb8519aadb4c26da4eb5d8ebe2b` |
| Official proxy sources | `PortSwigger/mcp-proxy@34183a803e3b309988f463f79f7c307a44714af5` |
| Proxy JAR SHA-256 | `6e70ebf2f4367f54c1e8a8ba94de89ba843773851de743bcfccb1e8aa23f796a` |
| Java for proxy / Burp | Temurin 21.0.12.1 / 25.0.4.1 |
| Codex | 0.165.0 |
| Playwright MCP | 0.0.83, separate from Burp MCP |

The proxy shipped in the official extension source has the **same checksum** as
our existing compiled official proxy. Docker verifies that bundled checksum
before embedding it. `burp-mcp-all.jar` is the Burp extension, while
`mcp-proxy-all.jar` is its stdio/SSE client. Do not interchange these artifacts.
The upstream MCP `serverInfo` reports `burp-suite` **1.1.2**, independently of
the extension's manifest version 1.3.0. The banner's version is this protocol
serverInfo, not an inferred Burp or extension release.

Sources: [official extension and build instructions](https://github.com/PortSwigger/mcp-server),
[official proxy](https://github.com/PortSwigger/mcp-proxy),
[official Burp downloads/checksums](https://portswigger.net/burp/downloads),
[Burp command line](https://portswigger.net/burp/documentation/desktop/troubleshooting/launch-from-command-line).

## Status and reconnect

The banner starts at `starting`, then reports `connected`, `unavailable` or
`incompatible` from a real Java/SSE handshake and inventory, never from the
bridge's three tools or a TCP-only success. Tool count and serverInfo version
are available in the status tooltip. Core Community is connected without
Professional tools. Regular probes update disconnections without a page reload.

Reconnect uses the authenticated target WebSocket and a private per-process Unix
socket. It selects only that workspace's relay processes, closes their old Java
transports, starts fresh ones, repeats initialization/discovery, sends MCP
`notifications/tools/list_changed` and waits for the result. It neither kills
tmux/Codex nor restarts shared Burp. Stdio close, timeout and target deletion
close the relay's own Java children. Concurrent requests share one connection
initialization. New consoles receive the config automatically; the root-owned
Codex launcher also injects it for existing immutable workspaces without changing
`scope.md` or their authorization snapshot. An already-running old Codex process
must be restarted/resumed once to load the new server configuration.

## Validation

Automated coverage includes inventory absence/zero/internal-only/core,
exclusions/wildcard boundaries, shared-history redaction, passive active-call
rejection, strict destination and UA for Repeater/HTTP, no active replay,
automatic target/host configuration, real Java mock-SSE reconnect, native Codex
tool discovery, target deletion during Recon/Codex and shared server survival.

The opt-in real-instance acceptance phase uses the same disposable full browser
harness, plus the actual built Burp image, not a fake endpoint:

```sh
RESEARCH_TEST_APP_IMAGE=bughunter-web:burp-test \
RESEARCH_TEST_RUNNER_IMAGE=bughunter-research:burp-test \
RESEARCH_REAL_BURP_IMAGE=bughunter-burp:official \
node --import tsx tests/research/runConsole.mjs
```

It sends only a controlled local browser request through actual Burp, reads it
through the actual official Java proxy/scoped relay, and calls
`mcpServer/tool/call` in installed Codex to retrieve that same marker. It also
tests the no-host program console, deletes that target while retaining shared
Burp, and tests real disconnection/restart/reconnect. It uses native Codex RPC;
no paid model inference, account login or textual `/mcp` scraping is required.

The real-instance run succeeded with the production Dockerfile build. The
browser's unique local request marker and required User-Agent were recovered by
an actual Codex `mcpServer/tool/call` to `get_proxy_http_history`. A fresh global
program console also read that scoped history, rejected an active call, and was
deleted through Settings without stopping the real shared Burp. A real Burp
stop/start was detected; reconnect rediscovered its tools and the restarted
Community history was empty, as expected. The pinned startup now removes only
its own old JVM scratch directories to avoid Burp's old-temporary-files modal.

Actual upstream `tools/list`: **24 tools**, `serverInfo burp-suite/1.1.2`,
Community core operational, Scanner/Collaborator absent:

```text
send_http1_request
send_http2_request
create_repeater_tab
create_repeater_tab_http2
send_to_intruder
url_encode
url_decode
base64_encode
base64_decode
generate_random_string
output_project_options
output_user_options
set_project_options
set_user_options
get_proxy_http_history
get_proxy_http_history_regex
get_organizer_items
get_organizer_items_regex
get_proxy_websocket_history
get_proxy_websocket_history_regex
set_task_execution_engine_state
set_proxy_intercept_state
get_active_editor_contents
set_active_editor_contents
```

### Commands and results

| Executed command | Result |
| --- | --- |
| `npm test` | 524 passed, 145 infrastructure/network tests skipped by this command |
| `TEST_POSTGRES_TMPFS=1 TMPDIR=/dev/shm TEST_APP_IMAGE=bughunter-web:burp-test node tests/queue/runInfrastructure.mjs` | 663 passed, 6 network tests skipped; real PostgreSQL/Redis, existing Prisma migrations and additive upgrade passed |
| `npm run test:network` | 6 passed, completing the 669 tests across these runs |
| `npm run test:auth` | Full integration/migration suite and browser auth/Redis-outage scenarios passed |
| `RESEARCH_TEST_RUNNER_IMAGE=bughunter-research:burp-test node tests/research/runInfrastructure.mjs` | Legacy SSH/passive MCP/isolation/persistence regression passed with mock SSE |
| `node --import tsx tests/research/runConsole.mjs` with the three image variables above | Disposable browser/target/host/Codex/RECON/deletion/reconnect tests, mock SSE and genuine Burp end-to-end passed |
| `npm run lint` | Passed, no warnings |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed, Next.js production build |
| `docker compose build research-console` | Production runtime image passed |
| `docker build -t bughunter-burp:official -f docker/burp/Dockerfile .` | Official pinned Burp/extension production image passed |
| `docker compose --profile burp config --quiet` and `git diff --check` | Passed |

No Prisma schema change or new migration is required. Only controlled local
fixture HTTP was generated for acceptance; no program assets were scanned.
Professional-only behavior remains untested/unavailable with Community. The
YesWeHack reference was not reachable during the audit; implementation and
protocol checks used the official sources and installed Codex 0.165.0 schema.

### Changed files

- Docker/service configuration: `.env.example`, `docker-compose.yml`,
  `docker/burp/Dockerfile`, `docker/burp/entrypoint`,
  `docker/burp/bootstrap.py`, `docker/burp/user-options.json`.
- Runtime/client integration: `docker/research/bughunter-portswigger-mcp`,
  `docker/research/validator/burp-proxy.mjs`, `burp-inventory.mjs`,
  `portswigger-main.mjs`, `portswigger-policy.mjs`, `console-mcp-config.mjs`,
  `codex-launch.mjs`, `codex-rpc.mjs`, `console-burp-main.mjs`,
  `playwright-launch.mjs`; `docker/research/console/server.mjs`,
  `docker/research/console/burp-reconnect.mjs`.
- Application: `src/lib/research/consolePolicy.ts`,
  `src/server/research/consoleWorkspace.ts`, `consoleRules.ts`,
  `src/components/ResearchTerminal.tsx`.
- Tests: `tests/unit/portSwigger.test.ts`, `tests/research/fakeBurp.mjs`,
  `tests/research/runConsole.mjs`, `tests/research/portSwiggerAcceptance.mjs`.
- Documentation: this file and `docs/BURP-MCP-RESEARCH.md`.

### Local deployment verification

The validated images were activated using
`docker compose --profile burp up -d --no-build web research-console burp`.
The dedicated service and terminal are healthy; `/api/health` reports PostgreSQL
and Redis up. An existing immutable program workspace, created before this
change, was checked with installed Codex's native API after deployment:

```json
{"deployment":"verified","upstream":"connected","officialTools":24,"nativeCodexTools":24,"existingWorkspace":true,"historyCall":"success","authorizedItems":0}
```

The new live Community project is empty; the browser proof was generated only
inside the disposable acceptance stack. Both live listeners are IPv4-mapped
loopback (`::ffff:127.0.0.1`), with no host port binding and a separate Burp PID
namespace. Existing workspace data, conversations, DB and Redis volumes were
retained. Refresh an already-open application page once to load the new console
UI; its next launch resumes the existing Codex context with the new MCP config.
