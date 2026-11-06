# Research Coverage

Coverage records **what was tested**, whereas Research Plan proposes what to examine. Coverage is Target-owned memory, independent of a terminal transcript and of Finding review. `COVERED_NO_ISSUE_OBSERVED` never means SAFE. Other methods, test identities and contexts remain unknown.

Open **View coverage** in Research. Counts summarize saved states plus objectives without a recorded dimension. Details are grouped by objective. A record identifies the Scope Asset, stable objective, observed surface, method/action, stable test slug, authentication context and optional comparison, Recon context snapshot, Research Session, date, action, result and evidence references. For example, `GET /api/orders`, `cross-account-read`, User A → User B is distinct from PATCH or an anonymous request. New Recon context identities do not silently inherit an old authenticated account's coverage.

## Recording tests

Use **Record structured test or status**, or write the explicit structured document and click **Import structured tests**:

- Persistent console: `findings/coverage-events.json`.
- Historical ZIP workspace: `research/coverage-events.json` (the session-specific API can import it).
- Contract: read-only `research/coverage.schema.json`.

The API accepts an explicit session ID; it must belong to the same Target and owner. Archived sessions cannot append tests. Completed states require existing safe relative evidence artifacts, verified without following symlinks or hardlinks. Hypothesis and test links must resolve to the same Target/objective. FINDING requires an existing Finding for that Target. None of these operations creates a Hypothesis, Finding, promotion or Report, changes review state, calls tools or extends scope.

States: NOT_TESTED, IN_PROGRESS, COVERED_NO_ISSUE_OBSERVED, INTERESTING, BLOCKED, HYPOTHESIS_OPEN, FINDING, NEEDS_RETEST. Retest is explicit in this first step; automatic change-to-retest routing belongs to the later Recon Diffs milestone.

Use a stable non-secret test slug to distinguish different security questions on the same URL/method. Keep the slug and dimensions when appending progress, a negative result or a retest request. `expectedRevision` prevents lost concurrent updates; a UUID eventKey makes import/retry idempotent. Changing an already-used eventKey's content is refused. Event history is append-only through the service; older negative results can be opened and paged independently of the latest state.

## Agent context

**Update agent context** publishes `research/coverage-current.json`, a pointer to immutable JSON/Markdown snapshots. Both Codex and Claude receive the same files, without provider inference or provider-specific interpretation. New sessions capture prior Target coverage, and persistent console authorization refresh republishes the current snapshot. Existing consoles discover the pointer through their refreshed Recon inventory. The content contains Already covered, In progress, Untested, Needs retest, exact recorded tests and Do not repeat instructions. Agents must re-read the pointer before repeating tests; publishing does not interrupt or inject commands into an active native conversation.

Context exports are bounded and explicitly marked when truncated. Complete coverage history remains in the database and UI. Export limits cannot delete records. No free terminal text, scanner match, Recon observation or plan objective is automatically marked tested. Source records identify researcher validation versus workspace import, not independently verified execution or proof of safety.

## Security and retention

Current ownership, session policy, origin, Scope Asset/path, captured objective and context checks apply to writes. Scope revocation blocks further records while retained history remains readable. The importer is opt-in and fixed-path, with a 512 KiB/100-event document limit; HTTP records are bounded to 32 KiB. At most 500 dimensions and 10,000 events per Target are accepted with explicit errors, not silent eviction. History pages contain 50 revisions.

Coverage stores redacted metadata and portable evidence references, not request/response bodies, credentials or terminal output. Password/cookie/Authorization/API key-shaped text, common email addresses and private-key blocks are scrubbed. Artifact paths must be non-secret and safe; keep unrelated personal data out of results. The [Evidence Vault](evidence-vault.md) registers these explicit proof references with shared durable IDs. Existing Evidence IDs may also be supplied as evidenceIds; sources are not copied or automatically promoted into Findings.

Closing/archiving or deleting a Research Session does not remove Target coverage. A deleted session's immutable reference is retained beside a nullable live FK. Existing artifact storage/deletion policies are unchanged; a reference does not promise that a deliberately deleted workspace file remains downloadable. Explicit Target deletion removes its coverage. Migration `20261106120000_research_coverage` is additive and never invents tests for old Recon, Hypotheses or Findings.
