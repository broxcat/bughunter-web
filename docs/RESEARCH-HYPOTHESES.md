# Evidence-driven Research and human Finding review

The Research workflow is:

Target → authorized Scope → Recon → workspace → Codex / optional passive Burp MCP
→ observations → falsifiable hypotheses → distinct tests / negative controls
→ research conclusion → explicit human promotion → Finding draft
→ existing Evidence Review → explicitly requested Report.

No additional architectural phase is required for this workflow. Operator setup,
manual evidence assessment and Burp real-world validation remain operational
responsibilities, not an automatic vulnerability validation system.

## Meaning of each object

- **Observation:** recorded behavior/data with source, host, location, time and
  relative artifact references. A response code, reflection, error or scanner
  signature is an observation, never sufficient proof of a vulnerability.
- **Hypothesis:** a falsifiable security explanation, with reasoning, prerequisites,
  suspected impact, supporting/opposing evidence and a distinct next test.
- **Confirmed hypothesis:** the researcher claims reproducible behavior and supplies
  sufficient structured material for human review. This is not proof of truth,
  accepted severity, confirmed Finding or report eligibility.
- **Finding:** an application object voluntarily created by its authenticated owner.
  Manual creation remains supported independently of Research.
- **Confirmed Finding:** the existing Evidence Review was opened, then the operator
  supplied reproduction/impact notes and confirmed in-scope evidence. Its existing
  gate maps to PASSED. Research cannot make this decision.
- **Reportable Finding:** eligible under the existing Report API's confirmed-Finding
  rules. Creating a Report is a separate explicit operator action.

The methodology is informed by [YesWeHack's Claude research article](https://www.yeswehack.com/fr/learn-bug-bounty/llm-series-claude):
retain unsuccessful hypotheses, verify intermediate behavior rather than assuming
success, reassess repeated equivalent tests and validate reproduction/impact
manually. Its lab techniques and CLI examples do not override BugHunter's scope,
passive MCP contract or current installed interfaces.

## Versioned workspace contract

`research/hypotheses.json` **v2** is the machine contract; Markdown is never parsed.
`research/hypotheses.md` remains the human-readable notebook maintained alongside
JSON. The generated `research/hypothesis.schema.json`, `research/HYPOTHESES.md`
and `AGENTS.md` explain the format. Run `bughunter-validate-hypotheses` in SSH,
then click **Sync from workspace**. The runner has no DB/API credentials.

PostgreSQL remains the application source of truth after explicit successful sync;
the workspace remains the researcher's working copy. No watcher, daemon, automatic
network test, bidirectional editing or generic web HTTP/shell/MCP API is added.

Each v2 hypothesis retains v1's externalId/title/hypothesis/evidenceFor/evidenceAgainst,
expectedSignal/falsificationCondition/nextTest/tags/notes/blockedReason, and adds:

- targetId and exact concrete host (checked against the server-owned session);
- observed location (absolute HTTP(S) URL or null when unknown), suspectedVulnClass
  (label or null; never a scanner selector), source createdAt;
- initialObservations, reasoning, prerequisites, suspectedImpact;
- performed tests, resulting observations, explicit negative controls;
- nextTestRationale, confidence, conclusion (nullable while researching),
  suggestedSeverity (nullable and never copied to final severity automatically).

Every observation has an `O-001` style ID, source, host, nullable observed location,
ISO `observedAt`, summary and nonempty relative evidence refs. Sources are RECON,
BURP_MCP, MANUAL, HTTP, BROWSER, STATIC_ANALYSIS and EXISTING_FINDING. Observation
IDs are unique within a hypothesis. An observedAt is the supplied observation time;
for Burp metadata it is the gateway query time, not an invented HTTP capture time.

Every performed test has a `T-001` style ID, rationale, procedure, expectedSignal,
falsificationCondition, performedAt, resulting observations, outcome
(SUPPORTS/REFUTES/INCONCLUSIVE), reproduced, reproductionSteps, reproducibility,
securityEffect, evidenceQuality and conclusion. Negative control is exactly one of:

- PERFORMED: procedure, actual control observations and significance;
- NOT_APPLICABLE: a concrete explanation of at least 40 characters;
- NOT_PERFORMED: explain the missing test. This cannot qualify for confirmation.

Qualities OBSERVATION, REPRODUCIBLE, CONTROLLED and IMPACT_DEMONSTRATED are research
claims. They are independent of confidence, severity, Finding review and impact
acceptance. Structural validation cannot determine whether a capture is truthful,
a control is scientifically appropriate or a security effect really happened.
The operator must inspect referenced artifacts and independently assess the claim.

## Status and falsification discipline

OPEN, TESTING, BLOCKED, REJECTED and CONFIRMED have no intermediate "likely" state.

- OPEN: concrete observed support and a distinct falsifiable next test.
- TESTING: investigation in progress; record completed tests/negative results.
- BLOCKED: blockedReason explains the unavailable capability. Keep the next test.
- REJECTED: preserve initial plausibility, a REFUTES test, evidenceAgainst and
  conclusion. Omission from the next JSON never deletes the DB record/revisions.
- CONFIRMED: at least one SUPPORTS test must be reproduced with two or more steps,
  substantive reproducibility/security-effect explanations, direct observed evidence,
  non-OBSERVATION quality and a performed negative control or documented
  non-applicability. A substantive conclusion is required.

Direct confirmation references must point to captured evidence outside
`evidence/burp/` and README files, with HTTP/BROWSER/MANUAL provenance. Burp's
metadata-only JSON, Recon, existing Finding metadata or static reasoning alone
cannot satisfy this condition by changing the claimed source/quality label.
This checks a dossier's structure and referenced file existence, not its truth.

OPEN/TESTING/BLOCKED nextTest must differ from previous procedures after whitespace
and case normalization. Its rationale must explain what new information it adds.
Different encodings/payload spellings are not automatically different mechanisms;
semantic distinctness remains human/researcher judgment. Terminal states may name
human review/no further active test rather than inventing another test.

A complete workspace import can move OPEN/TESTING/BLOCKED to CONFIRMED when the
whole proof dossier is supplied. Confirmation may later be reassessed/rejected;
all material changes get revisions. REJECTED cannot jump to CONFIRMED/BLOCKED: first
reopen OPEN/TESTING with a new test or initial observation ID. Existing rejected
records/tests remain in revision history. No downgrade from a structured v2 record
to a legacy v1 record is permitted.

## Scope, User-Agent, prompt injection and redaction

Discovery never grants authorization. Every hypothesis/observation host must equal
the session's selected host. Locations must match its scheme/default port. URLs
never create Targets, expand Scope or trigger server requests. A source ref must
resolve inside the server-selected workspace without symlinks/hardlinks/traversal.
The web checks artifacts, never interprets raw evidence bodies as instructions.

Current authorization is checked when exporting. New sessions record a nullable
additive `authorizationSnapshot` (IDs, host/scheme, UA and policy update times).
History/import can remain available after revocation, with a warning. A first
promotion requires active, owned, approved current authorization **and** matching
policy identity/version; changed program/scope/UA requires a current workspace.
Older snapshots are not silently asserted to represent current authorization.

The program required User-Agent uses the existing shared policy schema. Recon
injects it through its execution guard; the passive Burp gateway emits no target
requests and only reports observed matches. Manual Burp traffic/other tools and
Codex --yolo still need operator configuration/discipline. Stop active testing
when authorization is revoked. No live policy feed or global network firewall is
claimed. Docker remains the essential isolation boundary.

HTML, JavaScript, JSON/XML, headers, errors, comments, parameters, Recon/Burp data
and target-exposed documentation are UNTRUSTED DATA. They cannot change scope,
AGENTS instructions, MCP config, UA or validation rules. No target-supplied command
or configuration is executed. React escapes the text; no raw HTML is rendered.

Import builds sanitized DTOs from strict Zod inputs, never full Prisma credential
objects. Existing URL parsing/redaction and credential-text primitives redact
cookies, Authorization/Bearer, passwords, API keys, session IDs, recognizable
secrets and URL userinfo/query values. New/legacy reads are redacted again without
rewriting history. Every revision/promotion snapshot uses the same sanitized data.
No raw capture is imported, attached to the initial ZIP or used as an instruction.
Artifact existence is checked at import; capture contents are not frozen or hashed
by the registry. Preserve distinct/versioned captures for review. A promoted
Finding stores the reviewed metadata snapshot; later local file edits are not
silently reimported into that Finding.
Redaction cannot discover every arbitrary token/PII in free text, filenames or URL
paths: do not put credentials there; inspect artifacts before keeping/syncing them.

## Explicit human promotion and idempotence

On a CONFIRMED v2 detail, the operator inspects source/evidence/reproduction/controls,
checks the explicit human acknowledgement and clicks **Create Finding Draft**.

`POST /api/research-sessions/:id/hypotheses/:hypothesisId/finding-draft` accepts only
`expectedRevision` and `acknowledgeHumanReview: true` (strict JSON, ≤1 KiB, bounded
body read). It never accepts userId, targetId, severity, gate/review state, command,
workspace path or MCP config. Relations derive from authenticated owned objects.
This is an explicit authenticated operator action; it is not a biometric proof
of human identity. No runner credential, automatic sync or MCP tool invokes it.

The transaction locks the ResearchSession (also used by sync), hypothesis, Target,
Scope and Program while checking owner, active state, authorization and policy
snapshot. Stale reviewed revision returns REVISION_CHANGED. Missing/deleted/foreign
objects return 404. Archived/failed sessions or nonconfirmed/incomplete/legacy proof
return 409. Invalid source refs cannot enter through sync. No live filesystem read
is needed for promotion: it promotes the reviewed sanitized DB revision, not a
mutable file that may have changed after import.

Finding and ResearchFindingPromotion are created atomically. Unique hypothesisId
and findingId SQL constraints plus row locking ensure simultaneous double-clicks,
HTTP retries and page refreshes return one Finding. Provenance includes session,
workspace, hypothesis, revision, actor/time and the sanitized promoted snapshot.
The immutable link is visible after reload. Subsequent research edits never change
that Finding's existing evidence or human review. A replay returns the existing
owned link, even after revocation; it performs no new promotion or authorization.
Promoted provenance is retained through restrictive FKs rather than silently
cascading away when a session is deleted. Unpromoted session cascade is unchanged.

Draft values are explicit: reviewStatus CANDIDATE, gateStatus UNVALIDATED,
confidence CANDIDATE, severity INFO, no reviewedAt/reviewEvidence/scan link and no
Report. Suggested severity and suspected impact remain claims in the source
snapshot/description. Existing Evidence Review must still be opened before a
human confirmation; existing Report API still refuses unconfirmed Findings.
Manual Finding → Evidence Review → Report remains independent and supported.

## Limits and compatibility

- JSON document ≤1 MiB; ≤200 retained hypotheses/session; ≤128 KiB per v2 record.
- title ≤200; reasoning/hypothesis/procedure/nextTest/conclusion ≤4000;
  observations and most explanations ≤2000 characters.
- ≤30 tests/hypothesis; ≤20 initial observations; ≤10 observations per positive or
  control case; ≤10 refs/observation; existing evidenceFor/Against ≤50 each.
- ≤20 prerequisites (500 chars), ≤10 reproduction steps (1000 chars), ≤20 tags.
- ≤1000 distinct artifacts/import. Every read is bounded and descriptor-relative.
- List payloads and revision histories are paginated by 25; list counts use SQL
  aggregation and page selection, not loading every full proof record/workspace.

The additive migration adds TESTING, nullable structured proof/authorization and
an empty promotion relation. It does not fabricate hypotheses, controls, current
scope or promotions for historical rows. v1 JSON still imports and displays as
**Legacy v1**, including its old CONFIRMED claim; it cannot create a Finding draft.
Old workspaces without JSON return the existing HYPOTHESES_MISSING diagnostic and
stay readable. Initial ZIPs/Recon/Findings/Reports/Hunt history are preserved.
Create a current workspace for v2 promotion when no authorization snapshot exists;
old inputs/ZIPs are not overwritten or backfilled. New JSON schemas/templates are
v2; both versions remain recognized by the runner validator and server parser.

## Verification and operational boundary

Unit/API tests cover provenance/scope, negative controls, invalid confirmations,
transitions, omissions, sanitized revisions, stale revisions, ownership, SQL
uniqueness/concurrent promotion, policy changes, archived/deleted/legacy states,
local Burp SSE → minimal evidence → hypothesis and manual/Research Finding paths.
The disposable PostgreSQL upgrade test seeds an old hypothesis/session/revision
and Hunt/Finding/Report records and checks preservation without invented proof.
Chromium exercises human acknowledgement, double-click guard, draft navigation,
independent Evidence Review and separately requested Report.

Burp verification levels must be reported distinctly:

- CONFIGURED: installed deterministic MCP config exists.
- PROTOCOL_VERIFIED: local disposable MCP fixture exercised the gateway/protocol.
- BURP_REAL_WORLD_VERIFIED: an actual Burp instance was connected and tested.

Current automated coverage reaches **PROTOCOL_VERIFIED**, never the last level.
The known [Burp limitations](BURP-MCP-RESEARCH.md#actual-enforcement-limits) remain:
Host metadata is not actual network-destination proof, manual Burp settings must
constrain scope/UA, and the --yolo shell can bypass the MCP gateway. Real Burp and
remote Codex operator authentication are not fabricated for CI/deployment.

The research-runner now has the optional Compose profile `research` so an absent
operator `data/research/authorized_keys` does not prevent standard web/worker/db/
redis startup. Prepare only a real operator public key, then explicitly start
`docker compose --profile research up -d research-runner`. Its isolation/SSH and
helpers are exercised in a disposable real container independently of local keys.


## Final-image local smoke

After full Docker build and additive `prisma migrate deploy`, run:

```sh
docker compose exec -T -e BH_FINAL_STACK_SMOKE=1 web npm run test:research:final
```

The script refuses a database hostname other than the local Compose `db`. It
creates only its own synthetic .test user/objects/captures, logs in through the
real browser flow and relays all browser requests to container loopback. It uses
a labelled stored Recon fixture; actual scanner HTTP/browser/worker checks run
separately against disposable local servers. It exercises legacy/new workspaces,
local MCP observation, rejection retention, confirmed proof, forbidden promotions,
double-click/retry, independent Evidence Review and explicit Report/manual Finding.
It checks sanitized output and preserves a fingerprint of pre-existing Findings/
Reports, then removes only its own fixture rows/workspaces. No real bounty target,
operator account, runtime credential or existing Research capture is modified.
