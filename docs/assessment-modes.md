# Assessment modes

The platform retains one workflow: Targets → Scope → Recon → Research → Findings → Report.

**Black-box** (`BLACK_BOX`, the default) uses authorized externally observable evidence: scope, DNS, HTTP/services, public pages/JavaScript/APIs, passive sources, supplied Recon and existing Burp observations. It assumes no internal source, architecture or private documentation access. Explicitly enabled verified test sessions can additionally support [authenticated runtime Recon](authenticated-recon.md).

**White-box** (`WHITE_BOX`) registers explicitly authorized source-context metadata alongside the same external assessment. It does **not** fetch repositories, read archives, ingest documentation, run static analysis or inspect source code. Every registered source has `contentAvailable: false`. Neither mode changes Recon tools, budgets, providers or rules of engagement.

Authenticated mapping uses the same scoped runtime engine in both modes. Personas are operator-declared, context differences are observations only, and no source-assisted role correlation is performed. Source metadata never supplies request seeds or authorizes credentials on a new host.

## Critical boundary

**Source authorization does not expand network authorization.** Advisory context is distinct from Execution permission. `ScopeAsset`, existing scope/exclusion checks, and live authorization remain the sole network authority. A source locator or note mentioning `internal.example.local` never authorizes that host, its redirects, scanners, Burp or browser traffic. Changing Asset Value or assessment mode grants no additional network access.

Recon → Map → Find → Prove → Report and the existing distinction between observation, inference, hypothesis, evidence and Finding remain intact. Sources can help future analysis; registering one proves neither an observation nor a vulnerability. This reuses the scope/triage/provenance principles documented in [Recon methodology v2](recon-methodology-v2.md), including Claude-BugHunter, Claude-Red and pentest-ai-agents. No external skill repository or offensive technique is imported.

## Target settings and source scopes

Use Target settings → Assessment mode. Switching either direction requires explicit confirmation. The Target page/list show only a compact mode badge. White-box settings expose the Authorized sources list; returning to Black-box retains the records but makes all of them ineffective.

Source classifications: Git repository, source archive, API specification, architecture documentation, configuration and Other. Records hold label, locator, optional branch/ref, include/exclude paths, enabled state, notes and timestamps. Remove deactivates the record; Reactivate enables it again. A source is effective exactly when the Target is White-box and that record is active. Deleting a Target cascades its current source records; other Targets are untouched.

Locators are metadata-only HTTP(S) URLs or repository-relative source identifiers such as `bundles/backend.zip`. URL userinfo, query parameters and fragments are refused, along with obvious credential material. There is no repository credential field or credential integration. Labels/refs/notes are bounded; do not put secrets in them.

Paths are repository-relative metadata. Slashes are normalized and paths deduplicated/sorted. Traversal, absolute/drive/UNC paths, NUL/control characters and encoded path-boundary escapes are rejected. Empty include/exclude lists describe no additional path restrictions; they do not cause files to be opened. Refs are validated as non-secret revision identifiers. At most 100 source records can be configured per Target.

## Snapshots and historical compatibility

Migration `20261104150000_assessment_modes` adds `AssessmentMode`, `AssessmentSourceKind`, `AssessmentSource`, `BountyProgram.assessmentMode`, and nullable mode/source snapshots to `TargetReconRun` and `ScanRun`. Existing Programs become Black-box; existing runs retain NULL snapshots and are displayed as **Legacy / mode not captured**. Existing Research sessions, summaries, Findings and Reports are not rewritten.

Recon captures mode and effective metadata under the same Program lock used by settings mutations. All children copy the persisted parent snapshot. Legacy standalone scan-request creation also captures a Program snapshot when present. Mode changes, source edits and deactivation affect subsequent executions; they never reinterpret historical runs. Source metadata includes ID, classification, locator, ref, paths, `updatedAt` revision and explicit unavailable-content/origin markers. Notes and credentials are not snapshot inputs.

Research captures assessment metadata in `ResearchSession.authorizationSnapshot` at creation, independently of the selected Recon's historical mode. Both Codex and Claude receive the same read-only `assessment-policy.json`, scope.md and generated instructions/target metadata. Current mode/source changes do not rewrite or interrupt existing consoles. Assessment-only updates preserve the legacy Program `updatedAt` network-policy identity, so they cannot masquerade as a network-policy revocation. Actual network policy changes and scope revocation still use the existing checks.

The Research Recon context carries a bounded mode/count/policy-file reference, not duplicated source lists. The deterministic Recon Summary shows the captured mode and source count, with source analysis explicitly not performed. Source locators and source metadata are excluded from inference payloads; AI routing remains unchanged. scope.md remains factual and deterministic. A mode is not permission to disclose source code to an external AI.

Future evidence origins are `RUNTIME`, `SOURCE`, `SPECIFICATION`, `DOCUMENTATION`, `CONFIGURATION`. Current scanner artifacts remain runtime evidence; source-authorized metadata must not be inserted as runtime observations. Future Source Intelligence/Code Evidence must carry explicit provenance and its own content snapshot. Research Plan, dynamic/source coverage, Root Cause and restricted-AI data policy are future work, not implemented here.

## API and deployment

Authenticated owner-only endpoints, blocked while the Program is deleting:

- `PATCH /api/programs/:id/assessment` with `{assessmentMode, confirmed: true}`.
- `GET/POST /api/programs/:id/assessment-sources`.
- `PATCH /api/programs/:id/assessment-sources/:sourceId`.
- `DELETE /api/programs/:id/assessment-sources/:sourceId` (deactivate).

Mutations reuse the application Origin check, bounded metadata bodies and strict schemas. They make no request to a source locator and create no Scope Asset.

After pulling the commit, rebuild the shared web/worker image and apply the additive migration before recreating those services:

```sh
git pull --ff-only origin main
docker compose build web worker
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d --no-deps web worker
```

No research-console/Burp image rebuild, volume deletion or database reset is required. Existing user sessions retain their snapshots.
