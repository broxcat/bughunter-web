> Historical documentation: the vulnerability-family Hunt engine is retired.
> See [Codex Research](CODEX-RESEARCH.md) for the current workflow.

# Hunt readiness and execution policy

Reviewed 2026-10-26. Business Target is `BountyProgram`; technical `Target` remains
an owned historical host identity. Existing credentials, findings and scan history
retain their identities. No second secret store or generic exploit engine exists.

## Selection

`resolveHuntFamilies` is the shared authority for preview and execution. Explicit
non-qualifying aliases exclude a family first. Otherwise a nonempty qualifying
list selects only supported matching capabilities; an empty list permits every
supported family. Unknown names are UNSUPPORTED, never executable. See
`src/lib/hunt/policy.ts` for the closed name-to-family mapping. AUTHENTICATION
includes authentication/JWT/OAuth; ACCESS_CONTROL includes access-control and
IDOR/BOLA; RCE includes command injection, SSTI and deserialization. Each family
still has its own applicability and prerequisites. RFI has no automated capability.

At execution start `ScanRun.huntSnapshot` freezes the qualifying/non-qualifying
lists, selected families, closed decision reasons and per-run approvals. Later
Target edits cannot replace that snapshot. The worker separately freezes the
actual required User-Agent. Current active scope and exclusions are rechecked
before every Hunt request; revocation stops further requests in the current run.

## Readiness

`HUNT_FAMILY_REGISTRY` describes prerequisites, techniques, risk and references.
The metadata-only readiness endpoint never signs in or contacts the target.
READY can run applicable safe methods. DEGRADED can run the safe subset without
claiming authenticated coverage. BLOCKED and NOT_APPLICABLE are skipped and
explained; neither blocks unrelated families. NOT_SELECTED never executes.

A primary/secondary account needs explicit ACCOUNT_A / ACCOUNT_B classification
and different credential material. BOLA additionally needs an explicit object URL
owned by the second identity on the same host. Inventoried references alone do
not prove ownership. IDOR discovery remains available without accounts and never
guesses neighboring IDs. A privileged role cannot be inferred from a label.

CSRF readiness describes coverage gaps, not permission to submit forms. Even with
cookies, browser and state-changing endpoints, real action replay remains
UNSUPPORTED. Similarly XML availability does not enable file-reading XXE, and
business workflow discovery does not authorize purchases, races or mutations.

JWT requires actual token availability; actual validation additionally requires
usable token material and an applicable protected object. OAuth requires an
observed flow; missing XML/OAuth becomes NOT_APPLICABLE after completed discovery.
SSRF discovery works without OOB, but callback testing requires explicit
`OOB_PUBLIC_BASE_URL`. There is no implicit callback destination. Metadata, LAN,
cloud credentials and arbitrary third-party callback destinations are not probed.

## Family prerequisites and counts

Counts are descriptor counts, not guaranteed executable methods for every host.
Applicability, prerequisites, approvals and limits can reduce the executed subset.

| Family | Total | Automatic safe | Approval-only | Unsupported | Prerequisites |
| --- | ---: | ---: | ---: | ---: | --- |
| auth-bypass | 3 | 3 | 0 | 0 | AUTHENTICATED_SESSION (recommended) |
| idor | 3 | 3 | 0 | 0 | PRIMARY_CREDENTIAL (recommended), SECOND_CREDENTIAL (recommended), SECOND_USER_OBJECT_REFERENCE (recommended), OBJECT_REFERENCE (recommended) |
| bola | 2 | 2 | 0 | 0 | PRIMARY_CREDENTIAL (required), SECOND_CREDENTIAL (required), SECOND_USER_OBJECT_REFERENCE (required), OBJECT_REFERENCE (recommended) |
| xss | 4 | 3 | 0 | 1 | AUTHENTICATED_SESSION (recommended), BROWSER_CONTEXT (recommended) |
| csrf | 4 | 3 | 0 | 1 | SESSION_COOKIE (recommended), STATE_CHANGING_ENDPOINT (recommended), BROWSER_CONTEXT (recommended) |
| sqli | 4 | 2 | 2 | 0 | AUTHENTICATED_SESSION (recommended) |
| command-injection | 4 | 2 | 2 | 0 | AUTHENTICATED_SESSION (recommended) |
| ssrf | 3 | 2 | 0 | 1 | OOB_CALLBACK (recommended) |
| xxe | 4 | 2 | 0 | 2 | XML_ENDPOINT (required), OOB_CALLBACK (recommended) |
| ssti | 2 | 2 | 0 | 0 | AUTHENTICATED_SESSION (recommended) |
| cors | 2 | 2 | 0 | 0 | AUTHENTICATED_SESSION (recommended) |
| jwt | 3 | 2 | 0 | 1 | JWT (required) |
| oauth | 2 | 2 | 0 | 0 | OAUTH_FLOW (required) |
| lfi | 3 | 2 | 0 | 1 | AUTHENTICATED_SESSION (recommended) |
| deserialization | 3 | 2 | 0 | 1 | None |
| business-logic-race | 3 | 2 | 0 | 1 | AUTHENTICATED_SESSION (recommended), STATE_CHANGING_ENDPOINT (recommended) |
| business-logic-tamper | 3 | 2 | 0 | 1 | AUTHENTICATED_SESSION (recommended) |
| business-logic-workflow | 3 | 2 | 0 | 1 | AUTHENTICATED_SESSION (recommended) |
| information-disclosure | 2 | 2 | 0 | 0 | None |

## Credentials and sessions

The existing encrypted `TargetCredential` is reused with purpose ACCOUNT_A,
ACCOUNT_B, SESSION_COOKIE, JWT or OTHER and optional owned-object metadata. Secrets
are AES-GCM encrypted; APIs/UI return labels and availability, never raw cookies,
passwords, bearer tokens, Authorization headers or encryption ciphertext.
EMAIL_PASSWORD credentials do not trigger an implicit login during a scan.
A user must explicitly approve signing into the test account via the existing
host credentials screen. A cached session expires after the configured TTL
(default 20 minutes). Availability is not a promise that a session is still valid.

Target detail and the edit form show immediate readiness for the selected policy.
Missing required items appear red, recommended items amber and ready states green.
Contextual links reuse host credentials and the operator OOB setting. The normal
Target form does not expose Prisma IDs or JSON configuration.

## Catalogue, evidence and approvals

The versioned catalogue owns applicability and execution selection. Recon URLs,
forms, parameter names, JS observations, cookie flags, technology labels, XML,
OAuth and object hints feed a shared bounded crawl, rather than one crawl per
family. Durable corpus metadata excludes response bodies, raw cookie values,
JWTs, private query values and OAuth state. Recent Recon observations are reused
within one hour, with current scope filtering.

PASSIVE and SAFE_ACTIVE handlers can run automatically when applicable. Exactly
four fixed HIGH_RISK timing methods can be approved per Hunt: SQLi and command
injection screen/confirm pairs. The Hunt form defaults to no approval. The API
rejects unselected families, missing explicit consent and every other technique
ID. Each pair uses fixed 1/2 second delays with matched zero-delay controls,
three samples per stage, at most 12 requests and 9 seconds of induced waiting.
All other state-changing/high-risk methods remain unsupported, even with a forged
approval. There is no shell input, reverse shell or arbitrary SQL statement field.

Signal → Candidate → Validated → Confirmed describes evidence, not severity.
Only CONFIRMED observations with independent controls create new Hunt Findings.
Validated callback or CORS behavior alone is not proof of vulnerability impact.
Existing historical PROVEN findings are shown conservatively as Candidate, or
Validated after the existing manual gate; historical data is not rewritten.
The manual report gate remains separate from automatic technical confirmation.

## Limits and HTTP enforcement

At most 4 techniques/family, 8 requests/technique, 24 requests/family, 100 total
requests including at most 12 discovery attempts. Concurrency 1; per-request 5s,
per-family 20s, global 120s; bodies read by the probe are capped at 64 KiB and
candidate storage at 80. Redirects are observed, not followed. Foreign discoveries
are recorded only as observations, never authorized by discovery. Action-shaped
GET URLs and non-read methods are blocked by the Hunt request guard.

The existing execution context injects Target UA case-insensitively into internal
HTTP and every routed Chromium request, overriding caller defaults. Chromium
blocks foreign hosts, service workers and WebSockets. External CLI tools are not
invoked inside bounded Hunt because their internal request counts cannot be
strictly accounted for; the catalogue uses bounded internal/browser handlers.
Recon/manual httpx, Katana, Nuclei and Dalfox integrations remain UA-enforced and
covered by actual local CLI smoke tests. Dalfox receives its own valid JSON config,
not the commented ProjectDiscovery YAML. DNS and TCP-only Nmap have
USER_AGENT_NOT_APPLICABLE.
