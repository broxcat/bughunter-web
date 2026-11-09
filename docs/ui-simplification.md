# UI simplification audit

Audited the main route inventory before editing, including host history, historical Research, the terminal boundary and legacy Hunt. This pass changes presentation only. Existing authorization, snapshots, engine semantics, persistence and provider routing stay authoritative.

| View | PRIMARY | SECONDARY | ADVANCED | DIAGNOSTIC |
| --- | --- | --- | --- | --- |
| Targets | Identity, platform, Scope count, latest Recon, Open | Search and paging | Target settings | Not repeated in inventory |
| Target | Identity, program link, workflow, next step | Compact readiness | Settings; Scope editing in Scope | No copied execution or evidence panels |
| Scope | In scope, out of scope, Add asset; asset/type/status/actions | Scope document access | Asset metadata, replacement, exclusions policy | Captured IDs/history in asset detail and documents |
| Recon | Target, state, last run, Open | History, execution count | Deterministic report | IDs, commands, provenance in run details |
| Recon run | Host, state, duration, ordered stages | Tool names and reasons | Stage details; report below timeline | Raw output and technical context disclosures |
| Recon report | Summary, Scope, observations, network, web, limitations, handoff | Changes | Optional AI narrative, methodology | Commands and provenance disclosures |
| Research | Target/host, Coverage, Recon readiness, engine/profile, Open console | Plans | Engine details, workspace removal | Native versions/auth details in disclosure |
| Findings | Title, severity, status, target, updated | Search | Finding details and lifecycle | Evidence/classification/history inside Finding |
| Reports | Saved identity and report body | Generate report | Finding selection, linked evidence | Evidence references inside disclosure |
| Settings | Configured providers and explicit default | Add/update provider | Endpoint override and routing explanation | Low-level values disclosed on request |

Creation previously rendered rewards, Scope hosts and rules, engagement rules, exclusions, vulnerability families and a mandatory User-Agent. Creation now renders Name, Platform and optional Program URL. Name is the only user-required field; the unchanged API receives the established `BugHunter/1.0` default. Creation grants no authorization and directs to Scope.

The fixed Research terminal and its keyboard boundary are outside the workspace styling changes.

## Visual comparison

The baseline is upstream `main` at `6b73f41`. Both versions use the same disposable Acme fixture. Fifteen populated views were reviewed in light/dark at 1280px and 390px (60 comparisons each). Screenshots and machine-readable density records are retained in `/tmp/bughunter-ui-review/before` and `/tmp/bughunter-ui-review/after`.

Visible words in the desktop fixture, including metadata:

| View | Before | After |
| --- | ---: | ---: |
| Target home | 98 | 36 |
| Target home + Scope workspace | 159 | 98 |
| Recon overview | 86 | 41 |
| Recon run + report | 726 | 433 |
| Research | 149 | 67 |
| Host Findings | 69 | 40 |
| Reports | 83 | 35 |
| Settings | 153 | 29 |

Scope now carries authorization work previously duplicated on the Target home. The Findings inventory adds the requested Updated field; its evidence and lifecycle controls are inside the Finding. Existing history and terminal routes remain available.

## Acceptance coverage

Run `node tests/queue/runInfrastructure.mjs --browser-only --simplification-browser` after building. This uses disposable services and no scanner worker. It covers the minimal form, native required-field validation, keyboard-only creation in all four theme/viewport combinations, optional fields, API errors, Escape/focus restoration, post-create Scope setup, stored defaults, advanced disclosures and responsive inventory routes. Existing post-v1 and Target asset suites cover policy changes, conflict handling, retirement, historical snapshots, live Recon, exports, evidence, provider selection and terminal keyboard behavior.
