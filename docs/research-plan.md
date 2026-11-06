# Research plans

Research turns structured Recon observations into a deterministic, versioned investigation plan. A plan proposes objectives; it does not run tests, create hypotheses, establish coverage, or confirm a vulnerability.

## Routing and priority

`ReconArtifact / ReconSurfaceObservation → signals → methodology registry → ResearchPlan / ResearchPlanItem → Research session → Codex or Claude`.

Version `research-plan/1` activates only evidenced categories: authorization, authentication, sessions, API/versioning, GraphQL, uploads, URL processing, redirects, business workflows, privileged interfaces, account lifecycle, tenant boundaries and input handling. Related API versions must actually be recorded. Static assets, negative controls, soft-404 equivalents, generic hygiene banners and tool failures do not independently create objectives. Every item carries real artifact/observation references, explanatory signals and a stable category/surface identity. Source evidence/signals remain empty.

Priority is High/Medium/Low, independently of vulnerability severity. Asset value, observed authenticated differences, evidence strength, relevant program categories and new surface influence ordering; none changes permission. Exact program exclusions suppress matching categories with a recorded decision. Ambiguous or conditional prose is retained as a limitation rather than interpreted as blanket authorization. Source metadata alone adds no priority. Absence of an objective never means tested or safe.

The engine groups demonstrable route instances, preserves original evidence, limits each asset to 20 objectives, and applies deterministic global count/byte limits to program-wide captures. Input bounds are 30 assets, 60 candidate scans and 1,000 structured artifacts; context observation exports have their existing independent bound. Truncation and incomplete Recon coverage remain visible limitations, separate from objectives. No raw logs or private response bodies are read. No default AI provider is required; version 1 makes no AI request.

## Persistence and handoff

Migration `20261104190000_research_plans` adds durable plans/items, a single-current-plan constraint per technical Target, and nullable references from sessions, Recon snapshots and hypotheses. Existing rows stay unlinked. Program/Target deletion cascades owned plans/items; hypothesis history retains nullable provenance rather than creating another workflow.

New usable terminal Recon triggers optional post-Recon publication. Failure cannot change the Recon outcome; metadata maintenance retries publication without repeating network work. Generation is fingerprinted by the methodology, selected runs, artifacts, context observations, captured assessment metadata and relevant current program/scope policy. A new version supersedes the earlier plan; absent surfaces are not considered resolved. The UI marks a plan stale when newer Recon or assessment configuration needs review.

Each plan captures immutable JSON and Markdown for delivery. Initial workspaces contain read-only `research/plan.json` and `research/plan.md`, plus digest-named versions. Explicit Recon handoff can publish another version and records which plan each signed delivery used. It never silently replaces the initial files or changes an existing session's initial plan. Codex and Claude read identical inputs. Symlinks, file replacement, writable inputs and digest mismatches are rejected.

Hypotheses can explicitly reference `planItemId` from the initial or last successfully delivered plan for the same Target. No hypothesis is created or linked by fuzzy matching. Rejected hypotheses remain visible; their status never establishes global coverage. Future Research Coverage can reference item IDs, but no coverage/checklist mechanism is implemented here.

Methodological references are the existing [Recon references](recon-methodology-v2.md#references-actually-studied): Claude-BugHunter (Define → Select → Execute; Map → Find), relevant Claude-Red Web/API/authentication methodology, and pentest-ai-agents Advisory versus Execution. They are design references, not imported execution permissions or copied skills.

On `/research`, the list shows stored objective counts, high priorities and Recon freshness from a batched server query. Use **View plan** beside a console to load its details; there is no request per console before opening one. A compact bar above `/research/[targetId]` preserves terminal space. The modal explains each objective, its rationale, observed surfaces, evidence references and existing research, including rejected hypotheses. Recorded target content is rendered as text.

The version selector retains historical plans. When new Recon produces another plan, an existing Research session keeps its captured plan until the existing explicit handoff workflow updates its context. Viewing another version does not update the session, start Codex/Claude or create a hypothesis. Missing or rejected work must not be interpreted as completed testing.

New plans use BLACK_BOX and runtime evidence only, including when the selected Recon has historical White-box metadata. Historical plans remain readable. Metadata never grants network authorization or proves application behavior. Scope checks remain authoritative; asset value changes prioritization, never permission.

Authenticated owners can read the current plan with `GET /api/research-plans/current?targetId=...` and an authorized historical version with `GET /api/research-plans/[id]`. Both responses use `Cache-Control: private, no-store`. They expose the public plan DTO rather than credentials, verification proofs, remote bodies or source file contents. GET may materialize a deterministic plan from stored evidence; it performs no network action or model inference.

Focused acceptance is available after building the app:

```bash
node tests/e2e/runResearchPlanWorkflow.mjs
```

The runner creates disposable PostgreSQL/Redis services and uses labelled synthetic Recon evidence. It tests the real plan service and browser UI. Terminal startup is explicitly blocked; it is not a real Codex/Claude validation and never scans a public target.

## Deployment

The embedded Research-console hypothesis validator and handoff prompt copy the shared contracts at image build time. This change therefore requires rebuilding that image as well as the shared web/worker image; no provider, Burp or MCP topology changes are involved.

```sh
git pull --ff-only origin main
docker compose build web worker research-console
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d --no-deps web worker
# Recreate only after active console sessions have been closed:
docker compose up -d --no-deps research-console
```

Building an image does not restart an existing console. No production database reset, volume removal or automatic historical workspace rewrite is required.

Current assessments are black-box only. Historical White-box metadata is read-only and cannot authorize source analysis or network access. New plans retain empty sourceSignals and sourceEvidenceRefs.

## Recorded Research Coverage

A plan objective is not a completed test. [Research Coverage](research-coverage.md) separately retains explicit tests, negative results, method/action and authentication contexts. Coverage never promotes an objective or hypothesis into a Finding.
