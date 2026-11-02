# BugHunter Web

License: AGPL-3.0-only ([LICENSE](LICENSE))

Bug bounty workflow: **Targets → Scope → Recon → Research → Findings → Report**.

A Target is a company or bug bounty program.
Create it at `/targets` with a company name and an explicit **Required User-Agent**.
Platform, program URL, rewards, scope hosts and vulnerability families are optional.
Enter `BugHunter/1.0` explicitly when the program has no special User-Agent.

Open the Target, then **Open Scope** to add, edit or remove FQDNs. All listed scope
hosts are active. Supported inputs include `example.com`, `api.example.com` and
`*.example.com`; case and the final DNS dot are normalized. Spaces, URLs, ports,
paths and queries are rejected. Wildcards remain rules: add a concrete FQDN before
scanning it. Discovery never automatically adds a new host to your authorized Scope.

The **Out of scope** tab supports add/edit/remove. Explicit exclusions always win,
even against a broader wildcard. Recon and Research let you choose a company, then an
active concrete host that has not been excluded. Removed hosts cannot start scans.

Qualifying and non-qualifying vulnerability families are optional program rules
exported into Research; they do not select an automated vulnerability checklist. Monetary values use
PostgreSQL `DECIMAL(18,2)` and decimal strings in the API, never binary floats.

Program edits apply to future executions. The backend injects the current program
User-Agent centrally into HTTP tools, internal probes and browser contexts. A scan
records the actual execution-time User-Agent; program edits never rewrite history.
See the [complete tool audit and HTTP guarantees](docs/scanner-http-audit.md),
including deliberate limitations on passive provider enumeration, arbitrary Nuclei
templates and browser redirects.

## Scan results

`ScanStatus` describes the job lifecycle (queued, running, completed, failed or
cancelled). The additive `ScanRun.outcome` field describes its execution result:
`SUCCESS`, `PARTIAL`, `FAILED` or `UNSUPPORTED`. A completed job is only successful
when its outcome is `SUCCESS`. `PARTIAL` means useful work completed but errors,
timeouts or request limits reduced the planned coverage. Policy exclusions and
non-applicable techniques do not count as failures; finding nothing is a success.
Queued/running scans have no outcome. Historical scans retain `outcome = null`
and are displayed with an unknown historical result, without inferring success.

Only `RECON` can be started as a scan. `HUNT` is retired (HTTP 410);
Codex Research uses separate ResearchSession records. `VALIDATE` has no implemented scan engine:
the API rejects it before creating a run/job; legacy queued jobs become
`FAILED` / `UNSUPPORTED`. Human finding evidence review is unchanged.
Deploy the additive Prisma migration before restarting the web app and worker.

Scan requests commit the run and a `ScanJobOutbox` delivery intent atomically in
PostgreSQL. `QUEUED` alone does not mean Redis received the job: the additive API
field `dispatch` is `PENDING`, `PUBLISHED`, or `null` for historical runs without
an outbox. Redis outages return **202 Accepted** with `dispatch: "PENDING"`;
confirmed delivery returns **201 Created**. `outcome` remains null until execution.

The worker starts the durable dispatcher automatically. It retries only delivery,
using bounded batches and a 1 second to 5 minute backoff. Each attempt uses a
separate producer connection (500 ms connect/command timeouts, 1.5 second overall
deadline, no reconnect/offline queue). PostgreSQL row locks with `SKIP LOCKED`
serialize publication without a persistent `PUBLISHING` state. Every BullMQ job
uses `jobId = scanRun.id`: a crash after Redis accepts the job is reconciled on
republication. Already started/terminal scans settle their intents without
re-enqueueing, and an atomic worker claim prevents duplicate network execution.
Execution retries remain disabled (`attempts: 1`). Existing retention is unchanged.

`POST /api/scan-runs` accepts an optional **Idempotency-Key** header (1–128 ASCII
letters, digits, `.`, `_`, `~`, `-`). The database enforces uniqueness per user;
replays, including concurrent requests, return the same run. Reusing a key with
different parameters returns 409. The scan forms retain the key when retrying an
unconfirmed request. No outbox or request keys are backfilled for historical runs.

`npm run test:queue` provisions disposable PostgreSQL/Redis containers, runs the
full test suite with real databases (including Redis stop/restart, stalled Redis,
concurrent requests and crash recovery), then tests the additive migration.
It requires Docker and removes only its own labelled containers afterwards.
The public health endpoint retains its existing dependency checks; delivery
attempts, backoff and overdue batches are logged server-side without raw errors.

Execution starts are recorded in `ScanExecutionAttempt` under an atomic PostgreSQL
claim. Each attempt records a distinct worker identity, heartbeat and durable
network/useful-work timestamps. BullMQ may invoke a stalled job again despite
`attempts: 1`; BugHunter refuses all implicit network replay. A recent attempt
remains owned by its live worker. Heartbeats run every **2 seconds**; attempts
older than **30 seconds** become `INTERRUPTED` at startup and during periodic
maintenance. A worker unable to confirm its DB lease for **10 seconds** stops
traffic before that expiry. These heartbeats are independent of BullMQ locks.
An interrupted scan is `FAILED`, with outcome `PARTIAL` only when useful work was
recorded durably, otherwise `FAILED`. Old scans without attempts remain unknown;
no attempts are backfilled. A new scan is required for any explicit rerun.

`POST /api/scan-runs/:id/cancel` is owned and idempotent: 202 records
`cancelRequestedAt`, repeated confirmed cancellation returns 200, and completed
or failed scans return 409. The worker polls the request with its heartbeat.
Queued cancellation is confirmed only after a DB claim proves no attempt started;
a late BullMQ delivery then exits without tools, even if Redis removal failed.
Active cancellation propagates an AbortSignal to fetch/body reads, DNS,
command process groups and Playwright contexts. Commands receive SIGTERM,
then SIGKILL after 500 ms if needed. A Unix IPC supervisor also kills the whole
tool group if the owning worker dies unexpectedly. `CANCELLED` with `outcome = null` is recorded
only after resource cleanup is confirmed. Reports, corpus, findings and logs stay
intact. UI cancellation is a request until confirmed by server state.

SIGTERM/SIGINT stops acquisition and dispatch, aborts active work and allows a
**5 second** grace period, followed by bounded forced cleanup/finalization.
Administrative shutdown or lost ownership becomes `INTERRUPTED`, not user
cancellation. If cleanup cannot be confirmed, it is also interrupted rather than
claiming cancellation. Stale recovery never requeues a started scan. Unstarted
queued jobs and the durable outbox continue normally after restart. A job acquired
concurrently with shutdown is returned to wait only when PostgreSQL proves it has
no start or attempt; it is never falsely acknowledged as completed. The queue
infrastructure suite also kills/restarts a real worker against a local HTTP target
and verifies there is no second network execution.

## Run

Next.js 16 / React 19, Prisma 6 / PostgreSQL, BullMQ / Redis, Auth.js, Tailwind 4.

```sh
cp .env.example .env
# Fill AUTH_URL, AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY and database/Redis settings.
# Run the Research console setup helper below before first Compose startup.
docker compose up --build -d
docker compose exec web npx prisma migrate deploy
```

Set `AUTH_URL` in `.env` to the origin used in your browser, including scheme and
port (for example `AUTH_URL="http://example.test:3000"`). Compose requires this
value for `web`. Auth.js v5 uses it for login, OAuth callbacks and logout; a
localhost value redirects to localhost even when you browse through another host.
After changing it, apply the environment with `docker compose up -d --no-deps
--force-recreate web`. A simple restart does not reload the container environment.

The supplied Compose stack exposes Next.js only inside Docker; the optional
Tailscale Serve ingress is described in [docs/TAILSCALE.md](docs/TAILSCALE.md).
Any trusted ingress must supply the public `Host`, `X-Forwarded-Host` and
`X-Forwarded-Proto` headers. The existing `trustHost: true` allows Auth.js to use
these for server auth actions; explicit `AUTH_URL` takes priority and also avoids
Next.js internal request URLs affecting authentication redirects. OAuth providers
must register callbacks under the same public origin (`/api/auth/callback/<provider>`).

### Authentication and anti-abuse

Public registration is **disabled by default**. Set
`ALLOW_PUBLIC_REGISTRATION=true` explicitly to expose the registration form/API
and permit new OAuth accounts. Existing password accounts and already-linked
OAuth accounts can sign in in private mode. Registration returns the same generic
HTTP 200 confirmation for new/existing addresses (including concurrent duplicates),
without auto-login or account fields. It never overwrites an existing password.
Provision an account privately with the operator CLI; provide a 10-character
minimum, 72-byte maximum password through stdin, not a command argument:

```sh
docker compose exec -T web npm run user:create -- admin@example.test "Administrator" < /secure/password-file
```

`TRUST_PROXY_HEADERS=false` ignores both XFF and X-Real-IP. Next.js does not expose
a trusted connection address, so these clients share an `unknown` IP quota. This
can restrict multiple legitimate users; configure a verified ingress for separate
IP quotas. Never enable trust solely because `AUTH_URL` is set. To opt in, set
`TRUST_PROXY_HEADERS=true` and `TRUSTED_PROXY_HOPS=1` (or the exact, fixed ingress
hop count, up to 16). Every XFF element must be a valid IP; selection proceeds
from the **right**, and IPv6/mapped IPv4 representations are canonicalized. No
X-Real-IP fallback is used. Direct client access to Next.js must be prevented;
variable-length proxy paths need a different ingress configuration. In trusted
mode, missing/invalid proxy identity refuses login/registration with HTTP 503,
so a malformed header cannot grant a second `unknown` quota.

Policies are centralized in `src/lib/abusePolicy.ts`:

| Operation | Quota | Anti-abuse backend unavailable |
| --- | --- | --- |
| Credentials login | 20/IP + 8/login per 15 minutes | HTTP 503; no password comparison |
| Public registration | 5 attempts/IP/hour | HTTP 503; no account creation |
| Scan creation | 20 attempts/user/hour in Redis; 20 created runs/user/rolling hour in PostgreSQL | Enforce PostgreSQL quota; accept via outbox, HTTP 202 while delivery is pending |

The login quota covers existing and nonexistent accounts before bcrypt. Login
identifiers are trimmed/lowercased and HMACed with `AUTH_SECRET` in Redis keys;
rotating that secret starts new account counters. OAuth does not use the password
limiter; private-mode account creation is still gated. Redis windows use an atomic
increment/expiry script and a dedicated producer bounded to one second, with no
unbounded offline queue. Exhausted quotas return HTTP 429 and `Retry-After`.
Scan creation serializes on the PostgreSQL user row and checks the durable quota
inside the same transaction as ScanRun/outbox creation, on every request, so Redis
loss/recovery cannot reset the budget. Idempotent replays consume no new database
slot. Database failure remains an error; scans/outcomes and scope checks retain
their existing semantics. Server logs use fixed diagnostic codes, not credentials,
email addresses, identity keys or raw Redis errors.

`npm run test:queue` also exercises real limiter concurrency and login/signup/scan
policies across a disposable Redis stop/restart. `npm run test:auth` additionally launches the built application and Chromium against
those disposable services to verify private/public forms, forged headers, real
429/503 responses and durable scan acceptance during Redis loss. Run
`npm run build` first. Other browser registration tests require
`ALLOW_PUBLIC_REGISTRATION=true` on their isolated application.

Local development: provision Postgres and Redis, configure `.env`, then:

```sh
npm ci
npx prisma generate
npx prisma migrate deploy
npm run dev
# Separate terminal; scanner binaries and Playwright Chromium must be installed:
npm run worker
```

## Data and upgrade

`BountyProgram` is the business Target. `Target` remains the technical host identity
because existing `ScanRun`, `Finding`, `TargetCredential` and `Report` relations
already depend on it. Internal `Scope` authorization records remain; adding a host
explicitly authorizes its exact identity without a separate approval screen.

Migration `20261026090000_bounty_program_scope` is additive. It adds the parent,
optional program relation, active membership flag, execution-time UA and a partial
unique index for active hosts per program. No existing row is removed or reassigned.

Old hosts appear in **Scopes → Previous hosts and scan history**. Add them explicitly
to a newly configured Target to scan again; there is no invented UA or automatic
scope expansion during migration. Old scans, findings, reports and credentials
remain accessible. Editing a FQDN creates a new identity and retires the previous
one; removing it only retires it. Historical references stay attached to their
original host. Previous host bookmarks redirect to their history page.

## Validation

```sh
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
docker compose config --quiet
git diff --check
```

API integration tests require a **disposable** Postgres database; their setup
clears test data. Never point `TEST_DATABASE_URL` at a database you want to keep.

```sh
docker run --name bh-workflow-tests -d -p 127.0.0.1:55439:5432 \
  -e POSTGRES_USER=workflow -e POSTGRES_PASSWORD=workflow \
  -e POSTGRES_DB=workflow postgres:16-alpine
TEST_DATABASE_URL=postgresql://workflow:workflow@127.0.0.1:55439/workflow npm test
# Real HTTP tool and browser captures (httpx, katana, nuclei, dalfox + Chromium):
npm run test:network
# Combined validation, including the actual tools:
SCANNER_HTTP_TESTS=1 TEST_DATABASE_URL=postgresql://workflow:workflow@127.0.0.1:55439/workflow npm test
```

Test an upgrade with existing historical rows in a separate **empty** disposable
Postgres database (the script refuses a nonempty database):

```sh
TEST_MIGRATION_DATABASE_URL=postgresql://.../empty_upgrade_db npm run test:migration
```

HTTP tools are pinned in Docker to the audited versions. Real network tests use
only a local HTTP server, check every captured UA, and reject foreign-host traffic.
The suite also covers scanner-proposed UA overrides, redirects, XSS confirmation,
rejection of implicit CSRF writes and explicitly requested credential login. The default suite runs local HTTP
client tests even without external tools; optional suites are skipped when their
prerequisites are not explicitly enabled.

The Target page now owns structured scope assets, per-asset Recon, scope.md
downloads and focused Research. See [Target Recon workflow](docs/target-recon-workflow.md)
for migration, boundaries, collection plans and deployment.

The browser workflow builds the app and starts disposable Postgres/Redis without
a worker (it enqueues one Recon job but runs no remote scan):

```sh
npm run test:ui
```

Secrets remain encrypted at rest. Credential values are never exposed by program
or host list APIs. Findings undergo an evidence review before they
can be included in reports.


## Codex Research

**Recon → per-target Codex console → hypotheses/tests/controls → human Finding draft → Evidence Review → Report.**

`/research` lists authorized concrete hosts. Open `/research/<Target.id>` for a
full-screen xterm.js Codex TUI, attached to one persistent tmux session and
`/workspaces/research_<Target.id>`. Refresh keeps the same session. The host root
is static operator configuration, e.g. `/home/brokcat/bughunter-research`:

```sh
node scripts/setup-research-console.mjs --root /home/brokcat/bughunter-research
# Set RESEARCH_HOST_ROOT and RESEARCH_WORKSPACE_UID/GID in .env.
docker compose build
docker compose up -d db redis
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d
```

The dedicated research-console receives no app env_file, Auth.js/DB/Redis/AI keys,
Docker socket or host home. Web signs short-lived Ed25519 terminal tickets; the
console holds only the public key. A minimal ingress proxy strips browser cookies
and Authorization; the terminal verifies dedicated tickets only. Tailscale provides same-origin WSS ingress;
no terminal port is published. Optional SSH remains host-loopback only. Codex
**0.165.0** is pinned and launches with verified **--yolo**. Operator login persists
independently in the Codex volume; no BugHunter provider key is copied.

[Burp MCP](docs/BURP-MCP-RESEARCH.md) uses the official PortSwigger 1.3.0 extension
externally and a pinned official STDIO proxy behind an exact-host/port/UA policy
gateway. Playwright MCP **0.0.83** uses the loopback Burp proxy. Both are configured
per project automatically. Burp offline does not prevent terminal startup.
Four pinned, unchanged skills are installed; their internal confirmation gates
remain intact. Details: [CODEX-RESEARCH.md](docs/CODEX-RESEARCH.md).

The clean workspace has scope.md, recon/, requests/, scripts/ and findings/;
source/ is optional. Scope never expands through discovery. Notes/captures belong
to the configured local operator UID/GID; critical inputs remain read-only.
[Hypothesis JSON v2](docs/RESEARCH-HYPOTHESES.md) remains an optional manual sync
feature under findings/. Research confirmation does not confirm a Finding:
explicit human promotion creates only CANDIDATE/UNVALIDATED, followed by existing
Evidence Review and separately requested Report creation. Manual Findings work
independently. No scanner/Hunt engine is reintroduced.

Old UUID ResearchSession records/workspaces/ZIPs remain historical, with details
at `/research/history/<sessionId>` and redirecting old bookmarks. Old Hunt runs
remain read-only at `/hunt`; new HUNT requests return 410.

```sh
npm run test:queue -- --research-browser
npm run test:research
# Actual locally configured final image, synthetic smoke only:
docker compose exec -T -e BH_FINAL_STACK_SMOKE=1 web npm run test:research:final
```

Tests use disposable/local services. Real Burp GUI and remote Codex inference
require operator setup and are never asserted from fixture/config checks alone.
