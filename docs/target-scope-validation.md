# Target / Scope validation

Validated locally on 2026-10-26, starting at `6d3bd11`, with isolated Postgres 16,
Redis 7, the production Next.js build and real Chromium. The application's existing
Docker services and database were not migrated or replaced by the tests.

## Checks

| Check | Result |
| --- | --- |
| `SCANNER_HTTP_TESTS=1 TEST_DATABASE_URL=... npm test` | 131 tests passed, 14 suites, no skipped tests |
| `npm run lint` | Passed, no disabled lint rules |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed; migrated deprecated Next middleware convention to `proxy.ts` |
| `docker compose config --quiet` | Passed |
| `git diff --check` | Passed |
| `TEST_MIGRATION_DATABASE_URL=... npm run test:migration` | Passed against an empty disposable DB, seeding historical data before the additive migration |
| `TEST_APP_URL=http://localhost:3101 npm run test:ui` | Passed against the production build, desktop and 390px mobile viewport, no page errors or horizontal overflow |

Existing tests remain enabled. The XSS browser decision mocks now supply an
explicit execution context and implement the browser interception methods; their
original assertions remain intact. Initial data-loading effects and SSE component
reset behavior were fixed rather than disabling existing ESLint checks.

## Covered behavior

- Required company and explicit User-Agent; missing/blank/header-injection values
  rejected. Rewards round-trip exactly, including the maximum `DECIMAL(18,2)` value.
- Program create/edit and ownership checks; unknown client fields cannot select
  owner or execution UA.
- Normalized FQDNs, preserved wildcards, URL/path/query/port/space rejection,
  duplicates and concurrent duplicate additions.
- Host edit creates a new identity. Remove retires it internally. Scan/finding,
  credential, report and report-item references remain attached to the original.
- Explicit assignment of a legacy host preserves its original Scope relation.
- Removed, out-of-scope, wildcard-only, foreign-owner and legacy unconfigured hosts
  cannot be enqueued. Execution reload rejects them independently of the API.
- Recon/Hunt selectors contain only eligible concrete hosts. Foreign discoveries
  receive no database authorization or automatic execution.
- Required program UA overrides proposed scanner UA in the internal HTTP client,
  httpx, Katana, Nuclei and Dalfox, verified on a local capture server.
- Chromium page/fetch traffic, redirect chains, XSS confirmation, CSRF PoCs and
  credential auto-login are captured with the exact program UA. Foreign-host
  requests are blocked. A shell-expression-shaped UA remains literal argv data.
- Empty qualifying/non-qualifying lists, explicit exclusions and shared aliases,
  and unsupported qualifying families are covered in Hunt execution tests.
- Program UA changes affect future execution contexts; saved historical run UA
  remains unchanged. Pre-migration runs retain null instead of an invented UA.
- Browser workflow covers creation, mandatory UA validation, rewards, scope CRUD,
  duplicate error, out-of-scope CRUD, program edit, Recon selection and enqueue,
  Findings and host-history navigation. No worker runs during the smoke test.

## Deliberate scanner limits

The [tool audit](scanner-http-audit.md) documents every current outbound path and
its flags. To make scope and UA enforcement deterministic:

- Nmap runs TCP connect scanning without application/service probes.
- Subfinder's passive-provider HTTP is not invoked; Recon resolves DNS instead.
- Nuclei runs the audited app-owned Git-config HTTP exposure template, subject to
  INFORMATION_DISCLOSURE policy, instead of arbitrary installed templates.
- Dalfox's browser and unrelated BAV checks are disabled; BugHunter controls its
  own browser confirmations.
- Chromium observes HTTP redirects without automatically following them. Cookies
  returned by the login POST are preserved; login flows requiring an additional
  redirect response to establish the session are unsupported.
- dnsx, ffuf and gau remain installed but have no runtime wrapper in this repo.
