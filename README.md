# BugHunter Web

Bug bounty workflow: **Targets → Scope → Recon → Hunt → Findings → Report**.

A Target is a company or bug bounty program (VINCI, Doctolib, a private lab).
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

## Run

Next.js 16 / React 19, Prisma 6 / PostgreSQL, BullMQ / Redis, Auth.js, Tailwind 4.

```sh
cp .env.example .env
# Fill AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY and database/Redis settings.
docker compose up --build -d
docker compose exec web npx prisma migrate deploy
```

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
or host list APIs. Findings still pass the existing manual triage gate before they
can be included in reports.


## Qualified Hunt workflow

Target qualifying vulnerabilities select supported Hunt families; non-qualifying
exclusions always win. Target detail shows missing accounts, sessions, JWT/XML/OAuth
context and OOB prerequisites before Hunt. Safe subsets run independently of blocked
families. Hunt progress separates Signal, Candidate, Validated and Confirmed evidence.
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
