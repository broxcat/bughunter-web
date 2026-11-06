# Authenticated runtime Recon

Authenticated Recon maps read-only runtime surface through explicitly supplied test sessions. It adds context observations to the existing Target → Scope → Recon → Research workflow. It performs no authorization exploitation, IDOR/BOLA testing, privilege escalation, form submission or Finding creation.

[Research plans](research-plan.md) can route authenticated-only surfaces and actual context differentials into advisory objectives with observation references. They never create hypotheses, Findings or tested-coverage claims automatically.

## Authentication contexts

Use the existing Target settings → Authentication section. Configure Cookies, Bearer, or Email/password; run **Test connection** explicitly; then enable **Use for authenticated Recon**. The optional persona is operator-declared, not a verified application role. Last verification and expiration remain visible. Historical credentials default to Recon OFF.

Scans consume verified sessions only. They never log in. Email/password contexts use only the previously minted encrypted session, never the password. Only enabled contexts whose session is VALID at scheduling can be planned. Each request rechecks the captured verification identity, current enabled state, expiry and live Target authorization. Changed/revoked sessions are not silently substituted or refreshed.

At most four distinct verified contexts are planned per asset. Extra contexts, expired/unverified sessions and duplicate identity hashes have explicit skipped states. Duplicate identities do not count as independent users. Unavailable optional contexts leave anonymous coverage valid. An internal failure after a context was planned remains a coverage gap; a lost session stops that context while preserving earlier observations.

## Scope and transport

Credentials belong to one concrete execution Target. They are never applied to a wildcard, sibling, parent, discovered host, external CNAME or source-metadata host. Exact origin (including port), `ScopeAsset` paths, exclusions and live revocation checks remain mandatory. HTTP redirects are observed but never followed with credentials. Historical source metadata is not network authorization.

Native probes and the guarded relay inject credentials server-side **after** scope, live-policy, safe-method and budget checks. Tool-provided Cookie/Authorization/Proxy-Authorization headers cannot override the managed context. No credential is placed in scanner arguments. Supervised scanner processes receive an environment allowlist rather than worker database/encryption/AI secrets.

Each context gets a fresh isolated browser context. Requests are intercepted, authorized and injected individually; only GET/HEAD are permitted. Forms are inventoried without submission, WebSockets are closed, external hosts and out-of-path URLs are blocked. Browser storage/cookies are never shared between accounts. Cancellation uses existing request/process/browser cleanup fencing; worker-loss handling still prohibits implicit network replay.

## Mapping and shared budgets

`AUTHENTICATED_MAPPING` is part of the existing Web / API mapping phase. It does not repeat passive discovery, DNS, ports, TLS or Nuclei per account. Existing authorized entry points are visited before new surface: validation URL, owned-object URL, observed routes and bounded links/specification GET references. Negative calibration controls are not mapping seeds. A bounded browser pass can contribute observed GET requests.

The existing per-asset request budget is shared, not multiplied by account count. A single envelope is reserved from it when verified contexts are planned:

| Asset value | Shared mapping requests, including anonymous comparisons | Native pages per context | Depth | Mapping timeout |
|---|---:|---:|---:|---:|
| Low | 16 | 3 | 1 | 30 s |
| Medium | 48 | 8 | 2 | 60 s |
| High | 96 | 12 | 2 | 90 s |
| Critical | 160 | 20 | 3 | 120 s |

Each context has at most one browser page and four browser requests, charged to that same envelope. Base anonymous work receives the remaining budget first; optional enrichment receives only what remains. Existing asset RPS/backoff limits apply. Budget/depth/context limits are recorded as limitations, never proof of full application coverage. Version 1 does not run authenticated FFUF/Gobuster or Nuclei; the shared relay supports protected requests without exposing headers to a CLI, but bounded native/browser mapping is the authenticated provider.

## Evidence and visibility

`ReconArtifact` retains canonical surface/provenance. `ReconSurfaceObservation` stores how each context observed it: method, safe URL, status, MIME type, redirect metadata, structural body hash/length, time and source. It stores no private response body. Raw private URLs remain transient; exported query values and identity path segments are redacted. A keyed canonical reference keeps different private resources separate even when their displayed templates match.

Derived classifications are deterministic:

- **PUBLIC**: content actually observed anonymously.
- **AUTHENTICATED_ONLY**: content observed authenticated, with an actual anonymous non-content response.
- **SHARED_AUTHENTICATED**: content observed by multiple independent authenticated contexts.
- **CONTEXT_DIFFERENTIAL**: all participating identities were actually compared and returned different visibility outcomes.
- **NOT_OBSERVED_IN_CONTEXT**: missing/unavailable evidence, never an assumed denial.

The classifications can overlap. A context differential records response differences only. It does not demonstrate broken authorization; manual Research must validate any hypothesis.

## Snapshots and handoff

Each new `ScanRun.authenticatedContextsSnapshot` captures metadata only: credential reference, opaque context key, safe label/persona, verification proof and eligibility. Secrets remain in the existing AES-GCM credential columns. The snapshot is immutable after scheduling. `authenticatedReconResult` stores coverage, and observations retain independent per-context statuses. Old runs with NULL snapshots remain **Legacy / authenticated context not captured**.

Summary and scope.md expose compact factual context/visibility tables. Research receives the same safe projection for Codex and Claude, using opaque aliases, provenance and explicit observation-only instructions. AI receives neither credential IDs/identity hashes nor raw bodies, private query values, ciphertext, passwords or tokens. Arbitrary operator labels/personas are not inference inputs. Existing Research sessions are not rewritten. The graph has observed-context relationships, never role-permission claims.

Black-box uses authorized runtime sessions plus external observations. Historical source metadata cannot enable source ingestion, role correlation or source analysis.

## Persistence, cleanup and acceptance

Migration `20261104170000_authenticated_surface` adds nullable persona, Recon opt-in (false), nullable run snapshots/results and the context-observation table. Observation records cascade with their ScanRun/ScopeAsset; existing Target cleanup revokes execution, closes resources and removes owned data. No historical run, credential ciphertext, Research session or Finding is rewritten.

Local acceptance uses disposable Docker databases/Redis and an internal fixture network:

```sh
AUTHENTICATED_RECON_TEST_IMAGE=<rebuilt-web-image> node tests/recon/runAuthenticatedRecon.mjs
AUTHENTICATED_RECON_TEST_IMAGE=<rebuilt-web-image> node tests/recon/runAuthenticatedRecon.mjs --browser-only
AUTHENTICATED_RECON_TEST_IMAGE=<rebuilt-web-image> node tests/recon/runAuthenticatedRecon.mjs --mapping-only
npm run test:queue
npm run test:network
```

The fixture maps anonymous/User/Manager responses, explicit cookie/Bearer/minted-session verification, session loss, duplicates, path boundaries and credential-leak traps. It makes no public-target requests. It checks real native worker/scanner execution separately from browser UI and mocked AI acceptance.

The mapping-only matrix exercises the actual guarded HTTP mapper for anonymous, cookie, previously minted Email/password sessions, Bearer API and two-context cases without repeating scanner playbooks. The two-account fixture observes User 403 versus Manager 200 on the administrative route; it records a context differential, never a Finding. Session/duplicate/scope/internal/relay failures retain structured reasons and retry policy. Expired/lost sessions, scope denials and identity collisions are never retried through login.

Deploy without resets or research-console rebuilds:

```sh
git pull --ff-only origin main
docker compose build web worker
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d --no-deps web worker
```

Current assessments are black-box only. Historical White-box metadata is read-only and cannot authorize source analysis or network access. New plans retain empty sourceSignals and sourceEvidenceRefs.
