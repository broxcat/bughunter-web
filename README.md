# BugHunter Web

License: AGPL-3.0-only ([LICENSE](LICENSE))

Bug bounty workflow: **Targets → Scope → Recon → Hunt → Findings → Report**.

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
even against a broader wildcard. Recon and Hunt let you choose a company, then an
active concrete host that has not been excluded. Removed hosts cannot start scans.

Qualifying and non-qualifying vulnerability families are optional. Empty qualifying
allows all supported Hunt families; an explicit non-qualifying family always wins.
Unsupported families do not enable new scanner capabilities. Monetary values use
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

Only `RECON` and `HUNT` can be started. `VALIDATE` has no implemented scan engine:
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

## Run

Next.js 16 / React 19, Prisma 6 / PostgreSQL, BullMQ / Redis, Auth.js, Tailwind 4.

```sh
cp .env.example .env
# Fill AUTH_URL, AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY and database/Redis settings.
docker compose up --build -d
docker compose exec web npx prisma migrate deploy
```

Set `AUTH_URL` in `.env` to the origin used in your browser, including scheme and
port (for example `AUTH_URL="http://example.test:3000"`). Compose requires this
value for `web`. Auth.js v5 uses it for login, OAuth callbacks and logout; a
localhost value redirects to localhost even when you browse through another host.
After changing it, apply the environment with `docker compose up -d --no-deps
--force-recreate web`. A simple restart does not reload the container environment.

The supplied Compose stack publishes Next.js directly and has no reverse proxy.
If you add one, preserve the public `Host`, `X-Forwarded-Host` and
`X-Forwarded-Proto` headers. The existing `trustHost: true` allows Auth.js to use
these for server auth actions; explicit `AUTH_URL` takes priority and also avoids
Next.js internal request URLs affecting authentication redirects. OAuth providers
must register callbacks under the same public origin (`/api/auth/callback/<provider>`).

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

For the browser workflow smoke test, start the built app against disposable
Postgres/Redis, without a worker (the test enqueues one Recon job but runs no scan):

```sh
TEST_APP_URL=http://localhost:3101 npm run test:ui
```

Secrets remain encrypted at rest. Credential values are never exposed by program
or host list APIs. Findings undergo an evidence review before they
can be included in reports.


## Qualified Hunt workflow

Target qualifying vulnerabilities select supported Hunt families; non-qualifying
exclusions always win. Target detail shows a compact Hunt readiness summary: scope,
User-Agent, public testing and authenticated session availability. Provide only
username/password or a session cookie, then use Test connection. Login forms and
CSRF are discovered automatically; a protected-resource comparison must prove a
session valid. Public Hunt remains available without authentication. Technical
family requirements remain internal or under collapsed Advanced diagnostics.
Hunt progress separates Signal, Candidate, Validated and Confirmed evidence.

Findings follow `CANDIDATE → EVIDENCE_REVIEW → CONFIRMED / REJECTED / INCONCLUSIVE`.
The former questionnaire is removed. Existing ciphertext, finding IDs and reports
are preserved by an additive migration. See [black-box authentication and evidence
review](docs/BLACKBOX-AUTH-UX.md) for session states, security limits and compatibility.

Run the isolated browser workflow against a built local app and the dedicated
disposable database (no worker or Internet target is used):

```sh
TEST_APP_URL=http://127.0.0.1:3315 \
TEST_DATABASE_URL=postgresql://.../bughunter_blackbox_e2e \
node tests/e2e/blackboxUx.mjs
```
Fixed bounded timing checks require explicit per-run approval; stateful business
actions and destructive exploit techniques remain unsupported.

See [readiness and limits](docs/hunt-readiness.md), the
[versioned technique catalogue](docs/hunt-technique-catalog.md), and the
[validation report](docs/hunt-validation-report.md). No worker is needed for UI tests:

```sh
TEST_APP_URL=http://127.0.0.1:3102 TEST_DATABASE_URL=postgresql://hunt:hunt@127.0.0.1:55441/hunt_clean node tests/e2e/huntWorkflow.mjs
```

Use disposable services only. The UI test enqueues a Hunt without executing it;
its completed report is a labelled database fixture for progression/evidence UI.
