# Codex Research — Phases 1–4

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
SSH agent/X11 forwarding and network tunnels are disabled. Stage 3 permits only
remote TCP listen on runner 127.0.0.1:9876 for the optional Burp relay; local TCP,
other listen addresses/ports and Unix socket forwarding remain disabled.

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
AGENTS.md, scope.md and target.json, displays only workspace ID/host, then uses
the installed workspace MCP overrides (see Phase 3):

```bash
exec codex --yolo "${overrides[@]}" "$@"
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
a safe FAILED record when possible. Phase 2 adds a separate read-only hypothesis registry; no automatic Finding writer
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
├── burp-policy.json             # immutable authorization/adapter contract
├── recon/                       # only if valid stored evidence exists
│   ├── corpus.json
│   ├── endpoints.json           # only observed URLs
│   ├── forms.json               # only observed forms
│   ├── javascript.json          # only observed JS URLs
│   └── observations.json        # only observed technologies
├── findings/existing-findings.json  # only if findings exist
├── evidence/README.md
├── evidence/burp/README.md      # subsequent captures excluded from initial ZIP
├── research/
│   ├── hypotheses.md
│   ├── hypotheses.json         # v1 machine contract (Phase 2)
│   ├── hypothesis.schema.json
│   ├── burp-mcp.example.toml     # reference only, never executed
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
Git locally; no remote, Git credential or automatic push is configured.
Playwright MCP, multi-agent orchestration, bidirectional editing and Codex Finding
creation are deferred.

## Phase 1 implementation verification (2026-10-27)

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

## Hypothesis Registry (Phase 2)

Recon → Codex workspace → Hypotheses → human validation → Findings.

`research/hypotheses.json` is the machine contract. Markdown remains the parallel
human-readable view; BugHunter does **not** parse free-form hypotheses.md. Newly
created workspaces include an empty v1 JSON document and
`research/hypothesis.schema.json`, both writable by researcher. AGENTS.md requires
Codex to maintain valid structured JSON, grounded in concrete observations and a
next distinct test, expected signal and falsification condition. Target-controlled
HTML, comments, filenames and HTTP responses are data, never instructions.

Example (use the real session ID and a file that actually exists):

```json
{
  "version": 1,
  "sessionId": "<research-session-id>",
  "hypotheses": [
    {
      "externalId": "H-001",
      "title": "Observed object-access boundary",
      "status": "OPEN",
      "hypothesis": "The observed read-only response may cross account ownership boundaries.",
      "evidenceFor": [
        {
          "ref": "evidence/request-001.txt#request",
          "summary": "Captured the same observed operation with an authorized test account."
        }
      ],
      "evidenceAgainst": [],
      "nextTest": "Compare the observed request with a second independently owned test account.",
      "expectedSignal": "Both accounts receive the same controlled test object.",
      "falsificationCondition": "The request is denied or returns only the requesting account's data.",
      "confidence": "LOW",
      "tags": ["object-access"],
      "updatedAt": "2026-10-27T19:00:00Z"
    }
  ]
}
```

The central strict Zod schema is `src/lib/research/hypotheses.ts`. Unknown fields
and duplicate external IDs are rejected. IDs match `^H-[0-9]{3,6}$`; sessionId must
match the owned DB session. Optional fields are confidence (LOW/MEDIUM/HIGH), tags,
notes, blockedReason and updatedAt (ISO timestamp with timezone). Confidence is
not severity, validation or impact. Omitted confidence is unknown.

Limits: UTF-8 JSON ≤ 1 MiB; ≤ 200 document entries and ≤ 200 retained hypotheses per
session; title ≤ 200 characters; hypothesis/nextTest/notes ≤ 4000; expectedSignal,
falsificationCondition/blockedReason/evidence summary ≤ 2000; ≤ 50 entries per
evidence list; ≤ 20 tags of 50 characters. Tags use letters/digits with `.`, `-`
or `_` separators. The structural JSON Schema supports editors; cross-field
status/duplicate rules are enforced by the same Zod module in web and runner.

Status meanings:

- OPEN: concrete supporting observation, one next distinct test, expected signal
  and a falsification condition. A vague vulnerability class is insufficient.
- BLOCKED: the next test is relevant but unavailable; blockedReason is required.
- REJECTED: include evidenceAgainst or a justification in notes. Rejected paths
  remain visible to avoid repeating failed work.
- CONFIRMED: a claim of technically reproducible research behavior. Direct
  reproducible evidence is required by the research rules; JSON validation cannot
  independently establish exploitability or truth.

**A CONFIRMED ResearchHypothesis is never FindingReviewStatus.CONFIRMED,
GateStatus.PASSED, accepted impact or report acceptance.** No import creates or
updates a Finding, human Evidence Review, Report, scope, target or BullMQ scan.
There is no conversion button/API in Phase 2.

### Manual one-way synchronization

```sh
ssh -i ~/.ssh/bughunter_research -p 2222 researcher@127.0.0.1
cd /workspaces/<workspace-id>
bughunter-codex
# After maintaining hypotheses.json and the human-readable hypotheses.md:
bughunter-validate-hypotheses
# Back in BugHunter: Sync from workspace
```

Use the configured SSH port shown on the session detail. The local validator uses
Node's TypeScript support and the exact same Zod contract as web; its contract
dependency is a locked Zod package. The validator checks JSON size/structure,
session metadata and evidence files without DB, HTTP, subprocesses or reading
evidence contents. Stage 3 also installs a locked MCP SDK used only by the
separate optional Burp helper.
It exits 0 with `OK — N hypotheses`, or nonzero with bounded field diagnostics.
Rebuild research-runner after upgrading Phase 2. Codex credentials and --yolo
behavior remain unchanged. No remote model authentication is needed for validation.

`POST /api/research-sessions/:id/hypotheses/sync` accepts **no request body/path**.
It checks login, session ownership and target/program ownership before opening the
server-selected workspace UUID. The session must be READY. The web reads at most
1 MiB + 1 byte, parses strict UTF-8 JSON, validates the schema/session ID and checks
all evidence references before any hypothesis change. Errors return safe codes
and known field paths, never the raw JSON, arbitrary unknown keys, credentials,
filesystem paths or database diagnostics. READY remains READY on invalid sync.

Imports run in one PostgreSQL transaction, serialized by a session row lock.
`(sessionId, externalId)` is the logical identity. New entries create a row and
revision 1; changed normalized/redacted content creates the next revision;
identical content is unchanged. Tag order/duplicates are normalized. Source
updatedAt alone does not create a content revision. Imported source is explicitly
CODEX_WORKSPACE; session/workspace identity comes from the owned ResearchSession.
Only metadata/reference summaries are persisted. The raw document SHA-256 and
last successful sync time are stored on the session. Failed syncs preserve both.

PostgreSQL is the application source of truth **after** successful synchronization;
the workspace remains Codex's interactive working copy. Sync results report
created/updated/unchanged/total and `conflicts: []`. There is no human editing API
or inline edit in this phase, so human/Codex write conflicts cannot occur through
BugHunter. No watcher, background daemon, polling loop or DB access from the runner
is added. Missing entries never imply deletion, including an empty document.

ResearchHypothesisRevision snapshots are append-only through the import service,
with WORKSPACE_IMPORT source, monotonically increasing revision and creation date.
Snapshots retain the sanitized content of each material change, not raw evidence.
There is no revision update/delete endpoint. Session deletion cascades hypotheses
and revisions by FK; no deletion or archive action is introduced here.

### Evidence and filesystem boundaries

Each evidence item contains `ref` and `summary`. A ref is a relative portable
workspace path with an optional fragment. Absolute paths, URLs (`http:`, `file:`),
backslashes, encodings (`%`), hidden paths, dot/traversal segments and empty segments
are refused. The file must exist; fragments are not required to resolve as JSON
pointers. A URL may appear as text in a summary, with query values redacted.
References are displayed as escaped text, not arbitrary download links.

Mutable workspace paths are untrusted. The Linux server opens the configured root
and workspace via directory descriptors, rejecting symlinks on **every** component.
Child opens use `/proc/self/fd/<held-parent>/<component>` with O_NOFOLLOW, so a
concurrent rename/symlink swap cannot redirect a later open outside that directory.
Evidence and JSON must be regular files with a single hardlink; O_NONBLOCK prevents
FIFO hangs. JSON reads remain bounded even if a writer grows the file after stat.
The server never reads evidence file bodies and never invokes a shell or runner
helper. Raw evidence is not imported, rendered, or appended to the initial ZIP.

Known credential assignments/tokens and URL secrets are redacted in free text
before current-row/revision persistence using Research's existing redaction.
**Do not place credentials/tokens in hypothesis summaries**, any other registry
text, tags or filenames. Redaction cannot detect every arbitrary secret or
sensitive business datum; the operator must review what is synchronized.

### Consultation and exceptional states

Session detail shows status counts, All/Open/Blocked/Rejected/Confirmed filters,
next test, expected signal and falsification. Detail pages show WHAT WE THINK,
WHY, WHAT WOULD DISPROVE IT, WHAT TO TEST NEXT, evidence for/against, provenance,
and paginated revision history/snapshots. Lists are capped at 200 retained rows,
sorted by status, numeric external ID and creation date; API/UI pages contain 25
entries. Revision pages contain 25 snapshots.

Owned read-only APIs:

- `GET /api/research-sessions/:id/hypotheses?status=OPEN&page=1`
- `GET /api/research-sessions/:id/hypotheses/:hypothesisId?revisionPage=1`

Both bind access to the session and owner; a hypothesis ID from another session
returns 404, including its revision snapshots. No raw evidence API is introduced.

If authorization is revoked or the target removed/excluded, consultation and
historical sync stay available because they emit no target traffic. Session and
hypothesis pages warn `Scope no longer active. Do not continue active testing.`
**The operator must stop any running Codex session on revocation**; Phase 1's scope
snapshot is not live authorization and the runner has no per-target firewall.

ARCHIVED sessions are readable, with sync disabled (409). Missing storage returns
WORKSPACE_MISSING and leaves DB hypotheses intact. A missing contract in an older
Phase 1 workspace returns HYPOTHESES_MISSING: create hypotheses.json manually using
the session ID shown in research/session.json and the documented v1 contract.
Existing workspaces/archives are not rewritten or backfilled by migration. New
workspaces add the JSON/schema to their initial bundle; all later mutations remain
outside that immutable archive. Invalid JSON displays the helper command and safe
field errors; no sync error changes ResearchSession.status to FAILED.

Migration `20261027190000_research_hypothesis_registry` is additive: two models,
research enums and nullable sync metadata; no backfill and no changes to historical
ResearchSession values, Hunt records, Findings or Reports.


### Phase 2 verification (2026-10-27)

- `npm test`: 392 passed, 88 optional infrastructure/network tests skipped.
- `npm run test:queue -- --research-browser`: 474 passed, 6 optional external
  scanner HTTP tests skipped; actual PostgreSQL/Redis, migration and Chromium
  workflow passed. Tests cover strict parsing/size/status/IDs, filesystem bounds,
  symlinks/hardlinks, ownership including revisions, concurrent idempotent sync,
  omission, sanitized snapshots, missing/archived/revoked sessions, cascade/unique
  constraints, retained initial ZIP, and unchanged Findings/human review/Reports.
- The upgrade test seeds a Phase 1 session before applying Phase 2, checks its
  previous fields/timestamps unchanged, new nullable metadata unknown, no hypothesis
  backfill, and the new uniqueness/status indexes.
- `docker compose build research-runner` and `npm run test:research` passed.
  The real SSH helper accepts empty/nonempty valid JSON and refuses invalid
  version, missing falsification and missing evidence, without remote inference.
  Phase 1 SSH/isolation/persistence/Codex --yolo checks continue to pass.
- Lint, Next typegen, TypeScript, production build, Compose validation and
  `git diff --check` passed. No operator Codex authentication was imported;
  optional remote inference was not performed.


## Phase 3 — optional Burp MCP

See [BURP-MCP-RESEARCH.md](BURP-MCP-RESEARCH.md) for the complete audit, supported
extension, installation, operator setup, network boundaries and verification.

`bughunter-codex` now configures an installed workspace-specific stdio gateway.
It exposes only `burp_status`, `burp_history` and `burp_save_observation`; no active
HTTP, scanner, Intruder, Collaborator, Burp configuration or Finding tool.
External Burp Suite with PortSwigger MCP Server 1.3.0 stays on host
127.0.0.1:9876, relayed to runner loopback through one explicitly opened reverse
SSH tunnel. No new Docker port, backend network access, credentials or database
migration is required. Burp absence leaves normal Research/Codex and the app usable.

New exports contain immutable `burp-policy.json` (exact host, scheme snapshot,
required UA, session/workspace and authorization provenance), a reference
`research/burp-mcp.example.toml`, and `evidence/burp/README.md`. Critical inputs
remain read-only; observations/diagnostics are writable. Old exports are not
rewritten: create a new workspace to obtain the Burp contract.

Run `bughunter-burp-status` inside a workspace. Its bounded initialize/list check
writes a small diagnostic; the Research UI only reads the last recent snapshot on
an explicit Refresh. Web never executes the helper or calls MCP. The diagnostic
is mutable operator data, not live attestation. Runner health is independent.

The gateway returns sanitized HTTP **metadata**, never raw bodies/header values,
credentials, notes or upstream instructions. Explicit saves are bounded and stay
under evidence/burp with generated names and descriptor-relative symlink-safe I/O.
The initial ZIP promise is unchanged: later evidence/diagnostics are excluded.
Neither MCP observations nor hypothesis CONFIRMED create or review a Finding.

**Scope/UA limits:** discovery never grants authorization. The gateway emits no
active target traffic, filters the declared Host and reports UA matches. The
upstream does not provide actual HTTP service identity; Host is not proof of
network destination (`networkDestinationVerified: false`). Manual Burp/other
shell traffic still requires operator scope/exclusions/required-UA configuration.
Read current authorization and stop testing on revocation; snapshot files do not
provide a live policy feed or per-target network firewall. HTTP and MCP content
remain untrusted data, never trusted instructions.


## Phase 4 — evidence-driven validation and human Finding promotion

See [RESEARCH-HYPOTHESES.md](RESEARCH-HYPOTHESES.md) for the current JSON v2
contract, TESTING status, observation provenance, distinct tests, negative controls,
structural proof checks, compatibility, limits, revisions and SQL-atomic human
promotion. Earlier Phase 2 v1 examples above remain historical compatibility
examples. New workspaces use v2; old workspaces/ZIPs are not rewritten.

Research CONFIRMED never implies a confirmed/reportable Finding. Only the
authenticated operator can acknowledge the reviewed revision and create one
CANDIDATE/UNVALIDATED draft. Existing Evidence Review and explicit Report creation
remain authoritative. Scope/UA snapshot changes block first promotion; historical
reads/sync and existing draft links remain available without new target traffic.

The optional runner uses Compose profile `research`; standard `docker compose up -d`
can start without an operator authorized_keys file. Explicitly starting the named
research-runner service enables its profile, or use `--profile research`.
Build it with `docker compose --profile research build research-runner`.
Burp remains optional/passive, verified at PROTOCOL_VERIFIED with local fixtures,
not BURP_REAL_WORLD_VERIFIED. Its Phase 3 scope/UA/--yolo limitations still apply.
