# Codex Research — Phase 1

Targets → Scope → Recon → Research → Findings → Report.

Research exports observations into a local, persistent workspace. It does not
schedule a BullMQ scan, execute Codex from the web, create Findings, or submit
reports. The methodology follows [YesWeHack's Codex research article](https://www.yeswehack.com/fr/learn-bug-bounty/llm-series-codex):
understand the application, maintain evidence-backed hypotheses, choose distinct
falsifiable tests, preserve negative results, and review impact manually.

## Architecture and isolation

```text
web -- dedicated shared volume --> research-runner
/research-workspaces               /workspaces/<UUID>
                                   SSH -> researcher -> bughunter-codex
worker -> Recon -> PostgreSQL       research_egress -> Internet
```

The runner uses its own `docker/research/Dockerfile` (Node 24, OpenSSH, Codex,
git, curl, jq, Python 3, ripgrep and Unix tools). It receives no application
`env_file`, Auth.js/OAuth secrets, database URL, Redis URL, AI keys, Docker socket,
application source mount, host home, or DB/Redis volume. Its only network is
`research_egress`, separate from the backend and Tailscale frontend. DB/Redis have
no published ports. Docker bridge isolation prevents direct backend connections.
Internet egress remains available; **scope is an agent instruction, not a dynamic
per-target firewall** in this phase. Review current authorization before each session.

Only workspaces are shared with web. Codex home/login state and SSH host keys use
separate persistent volumes accessible to the runner only. The privileged sshd
master authenticates and drops to UID/GID 2000 (`researcher:research`); all research
commands run as that non-root user. Its limited capabilities support that transition;
no `NET_ADMIN`, `NET_RAW`, privileged mode or Docker control is granted. The service
sets `no-new-privileges`, a PID limit and a memory limit.

The runner is a single trusted operator environment, not isolation between
untrusted BugHunter users. Its one SSH identity can read all exported sessions.
Web/API ownership checks still prevent cross-user list/detail/ZIP access. Only
give the runner's SSH access to the deployment operator; per-user runner isolation
is outside Phase 1.

## First deployment

Run on the Docker host, in the repository. Create a dedicated key **outside** the
repository; copy only its public half:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/bughunter_research
install -d -m 0700 data/research
install -m 0644 ~/.ssh/bughunter_research.pub data/research/authorized_keys
# Set RESEARCH_SSH_PORT=2222 in .env if changing the default.
docker compose config --quiet
docker compose build research-runner
# Deploy updated web/worker together; apply the additive migration before use.
docker compose build web worker
docker compose up -d db redis
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d web worker research-runner
```

`data/research/` is ignored by Git and Docker builds. No private SSH key belongs
there. The bind mount refuses to create a missing public-key file as a directory.
The source is read-only; entrypoint installs a root-owned authorized_keys file with
mode 0644. Restart the runner after changing the public-key file. Persistent host
keys prevent fingerprint churn across rebuilds; verify the fingerprint locally:

```sh
docker compose exec research-runner ssh-keygen -lf /etc/ssh/host-keys/ssh_host_ed25519_key.pub
```

SSH publishes **`127.0.0.1:2222:22`** by default. `sshd` listens on the container's
interfaces, while Docker publishes only the host loopback. It is not published on
`0.0.0.0`, IPv6 wildcard, LAN, Internet, or Tailscale. Root, password and keyboard
interactive login are disabled; public keys only, `AllowUsers researcher`.
SSH agent/TCP/X11 forwarding and tunnels are disabled.

```sh
ssh -i ~/.ssh/bughunter_research -p 2222 researcher@127.0.0.1
bughunter-workspaces
cd /workspaces/<workspace-id>
bughunter-codex
```

`127.0.0.1` in that SSH command is the **Docker host**. Inside the runner it means
the runner itself; it is not an address for a target running on the host.
Changing the port never changes the loopback binding. No Tailscale SSH publication
is added. Access from another machine requires a separately managed host tunnel
or future dedicated policy, not an expanded Compose publication.

## Codex version, authentication and mode

On 2026-10-27, npm's current stable package and the installed local CLI were
`@openai/codex@0.164.0` / `codex-cli 0.164.0`. That version is pinned by the image's
`CODEX_VERSION` build argument. See [official CLI installation](https://learn.chatgpt.com/docs/codex/cli)
and the [official command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
The documented and tested `--yolo` alias maps to
`--dangerously-bypass-approvals-and-sandbox`: commands run without Codex's approval
prompts or sandbox. This is **not** the more restricted automatic approval mode.
The Docker isolation and non-root identity form the external boundary.

The image build executes `codex --version`, `codex --help` and
`codex --yolo --help`. The infrastructure test repeats these as `researcher` and
executes `bughunter-codex --help` over a real SSH connection. The wrapper resolves
its physical working directory, requires a direct child of `/workspaces` with
AGENTS.md, scope.md and target.json, displays only workspace ID/host, then uses:

```sh
exec codex --yolo "$@"
```

No Codex account credential is imported from BugHunter or the host. In the SSH
session, authenticate independently with `codex login --device-auth` before the
first model session. Codex login state persists in `research-codex`. A separately
entered Codex credential is readable by processes running as researcher; never
reuse BugHunter application keys. Remote model inference requires your own
Codex account/access; automated tests do not authenticate or consume model tokens.

## Creating a workspace

Open `/research` or the host detail's **Create Research Workspace** button. Choose
a Target and concrete active host. The page shows the latest completed Recon.
Creating without Recon is allowed and explicitly labelled: there are no invented
observations. The latest completed run with a stored corpus supplies provenance.
Partial Recon results can supply evidence when their lifecycle is COMPLETED.

`POST /api/research-sessions` accepts **only** `targetId`. There is no client path,
command argument, shell execution API, or automatic Codex launch. PostgreSQL locks
the user's quota and selected target/policy rows; the server rechecks target,
program and scope ownership, active membership, APPROVED status, scope match,
required User-Agent, concrete FQDN and structured/legacy host exclusions. The
20-session/hour durable quota bounds filesystem exports. Scope/program changes
are held behind shared row locks until publication completes.

`ResearchSession` is independent of ScanRun/BullMQ. Its additive migration is
`20261027170000_research_sessions`. Statuses are CREATING, READY, ARCHIVED and
FAILED. Creation commits READY only with a complete export; failed exports receive
a safe FAILED record when possible. No hypotheses DB or automatic Finding writer
is introduced. ARCHIVED is reserved; there is no archive action in Phase 1.

A server UUID v4 identifies each workspace. The fixed server root is
`RESEARCH_WORKSPACE_ROOT` (`/research-workspaces` in Compose); the runner sees the
same volume as `/workspaces`. Files are written and synced under `.tmp-<UUID>`,
initially inaccessible to researcher, then renamed atomically to `<UUID>`.
Different targets/sessions never implicitly reuse directories. Web runs as the
existing image's root identity; GID 2000 is explicitly shared with researcher.
The parent has mode 3770 (setgid + sticky), so researcher can write there for the
healthcheck but cannot rename/remove root-owned sessions. Inputs/directories are
0440/2750, mutable research files/directories 0660/2770; no 0777 modes.

For non-Docker development the default root is `data/research/workspaces`, owned
by the web process. `RESEARCH_WORKSPACE_ROOT` may point at a different absolute
private directory; `RESEARCH_WORKSPACE_GID` defaults to the process group. A local
web process sharing with the container must be able to assign group 2000; prefer
the Compose web deployment, which already has the correct identity.

## Bundle and provenance

```text
<workspace-id>/
├── AGENTS.md
├── README.md
├── scope.md
├── target.json
├── program-policy.md
├── recon/                       # only if valid stored evidence exists
│   ├── corpus.json
│   ├── endpoints.json           # only observed URLs
│   ├── forms.json               # only observed forms
│   ├── javascript.json          # only observed JS URLs
│   └── observations.json        # only observed technologies
├── findings/existing-findings.json  # only if findings exist
├── evidence/README.md
├── research/
│   ├── hypotheses.md
│   ├── notes.md
│   └── session.json
└── scripts/README.md
```

Each data export cites its Target, Scope, ScanRun or ResearchSession and timestamp.
`scope.md` explicitly authorizes only the selected concrete host, lists recorded
exclusions, required UA and rules. Discovery never grants permission; redirects to
another host are forbidden. Other optional program policy fields appear only when
stored. Rules require ground truth, application mapping, evidence for/against,
a distinct next test, expected signal and falsification, and OPEN/BLOCKED/REJECTED/
CONFIRMED status. Static reasoning alone cannot confirm a vulnerability.

The exporter uses an explicit Prisma selection and explicit DTOs. No secret fields
are selected or decrypted. Auth contexts include label/purpose/availability only:
`available` means a context is stored in BugHunter, not that its credentials were
transferred or its session is currently usable. Raw HTTP bodies/headers, finding
evidence/descriptions, access instructions, AI config, password/cookies/bearer
values and ciphertext are omitted. URL credentials/query values and recognizable
secret assignments in policy text are redacted; a final forbidden-field check
fails closed. Ground truth remains sanitized metadata, not a raw traffic capture.

Bootstrap prompt:

> Read AGENTS.md, scope.md and all existing recon evidence. Build an initial map
> of the application and create only evidence-backed hypotheses in
> research/hypotheses.md.

## ZIP downloads

The ZIP contains **exactly the initial generated bundle**, under
`bughunter-research/`, with stable ordering/timestamps and bounded sizes. It is
built from in-memory allowlisted files at creation, never by recursively walking
a mutable runner directory. It excludes later notes, scripts, symlinks and any
secrets an operator might subsequently place in the workspace.

The immutable archive is under the web-owned `.exports` directory (0700), which
researcher cannot read or modify. Each download rechecks login, ResearchSession
ownership and target/program ownership. Files are opened with O_NOFOLLOW, checked
as single-link regular files, size bounded and SHA-256 verified against the DB.
Root/ancestor symlinks and path traversal are rejected. Status/detail responses
never include an arbitrary host filesystem path. The browser receives instructions,
not a terminal. Back up the workspace volume and DB together; Codex home contains
separate sensitive account state and should be backed up separately if desired.

## Hunt retirement and dependency audit

Before deletion, the active callers were `POST /api/scan-runs`, ScanStart, host
Run hunt, Hunt readiness/requirements and the worker's runHunt dispatch. Engine
modules called runFamilyTechniques through server/hunt/runtime and the payload
catalogue. Hunt-specific timing approvals/snapshots were engine inputs.

New HUNT requests now return HTTP 410 before creation/publication; direct scan
request admission also refuses them. The worker rejects old delivered HUNT jobs
as UNSUPPORTED before loading target execution or credentials. Completed historical
rows are never reinterpreted. Cancellation UI/API does not mutate legacy records.

Deleted: vulnerability-family orchestrator and scanner modules, server/hunt
runtime/budget/techniques/timing/readiness/snapshot, lib/hunt catalogue/payloads/
approvals/selection/readiness and active Hunt UI. Shared code was retained under
`server/recon/corpus`, `lib/observationSafety`, `lib/credentialMetadata` and
`server/credentials/responseFingerprint`. Recon, credential connection checks,
manual finding review and reports remain available.

Historical dependencies retained: Prisma `ScanType.HUNT`, `huntReport`,
`huntSnapshot`, `approvedHuntTechniques`, Finding.huntMetadata, `/hunt`, `/hunt/:id`
and owned `GET /api/scan-runs/:id/hunt`. LegacyHuntReport renders unknown/partial
old JSON without assuming a current engine schema. `/hunt` is history only;
primary navigation is Research. Historical findings keep their IDs and report
relations. No destructive/backfill migration is made. The old readiness endpoint
returns 410 and never decrypts credentials or probes a target.

Engine-only unit/integration/browser suites were removed with their implementation;
the total test count therefore decreases. Recon/auth/queue/cancellation/network
and finding/report tests remain, plus focused legacy rendering/ownership coverage
and new Research serialization/filesystem/ZIP/API/infrastructure/browser tests.
Older Hunt audit documents are marked historical; their old commands are not the
current workflow.

## Validation and troubleshooting

```sh
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
git diff --check
docker compose config --quiet
docker compose build research-runner
npm run test:research
# Disposable PostgreSQL + Redis: full tests, migrations and real browser workflow.
npm run test:queue -- --research-browser
```

The infrastructure test derives the service from the actual Compose configuration,
uses a temporary ed25519 key and a fixed unused **loopback** port, and destroys
only its own services/volumes. It verifies effective sshd settings, denied root/
password login, Codex version/flags, wrapper via SSH, writable notes, protected
inputs, restart persistence, absence of application secrets/socket, denied direct
Postgres/Redis connections and registry egress. No real bounty target is contacted.

- Missing `authorized_keys`: create the file first; never copy a private key.
- Permission denied: inspect `docker compose logs research-runner`, key file,
  `ssh -i ... -p ... researcher@127.0.0.1`, UID/GID and volume modes. Do not chmod 777.
- Connection refused: inspect `docker compose ps` and the configured loopback port.
- Port occupied: choose a different RESEARCH_SSH_PORT and recreate the runner.
- Codex not authenticated: run `codex login --device-auth` inside SSH; no app key is forwarded.
- No Recon JSON: run Recon first; only actual valid stored corpus fields are exported.
- Scope changed: create a new export; existing snapshots do not auto-refresh or
  extend authorization. Stop any running Codex session after revocation.
- ZIP integrity failure: investigate storage changes; do not package mutable runner
  directories as a fallback.
- Interrupted creation: a crash can leave hidden temporary/orphan directories
  without a READY session. An operator may inspect/remove those after stopping
  creation; never reuse them as another session. No automatic destructive cleanup.
- Named-volume ownership from a previous local setup: recreate an empty test
  volume or repair its owner/group as operator; never recursively change real
  research data without reviewing it.

Git initialization is deliberately omitted in Phase 1. Researchers may initialize
Git locally; no remote, Git credential or automatic push is configured. Burp MCP,
Playwright MCP, multi-agent orchestration, bidirectional sync and Codex Finding
creation are deferred.

## Implementation verification (2026-10-27)

- Default `npm test`: 337 passed, 72 optional infrastructure/network tests skipped.
- Disposable PostgreSQL/Redis `npm run test:queue -- --research-browser`:
  403 passed, 6 external scanner HTTP tests skipped; additive migration and actual
  Chromium Research workflow passed. The migration includes an old Hunt JSON
  report, snapshot and approval array and preserves their values exactly.
- `npm run lint`, `npx next typegen`, `npx tsc --noEmit`, `npm run build`,
  `git diff --check` and `docker compose config --quiet` passed.
- `docker compose build research-runner` and `npm run test:research` passed:
  actual codex-cli 0.164.0, valid --yolo, SSH wrapper, loopback-only publication,
  key-only non-root login, persistence and direct backend isolation verified.
- Remote Codex inference was not run: no operator Codex login/key was imported.
  External scanner-tool HTTP capture tests are optional and were not enabled;
  Recon's retained local HTTP/auth/browser and cancellation tests did run.

The retired engine's unit/integration suites and five engine-specific browser
scripts were removed with the deleted code. New focused tests replace them;
old catalogue/timing test counts are intentionally not preserved.
