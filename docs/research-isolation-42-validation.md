# Issue #42: runtime isolation validation

Runtime revision: `b32c4b2beec468ee11a1ab48a1ad5bbf97463d9c`, based on `818c6f4e764a948b8fe8c169ea0bf69baf98c84b`. Validation date: 2026-11-07. Production was not migrated, restarted or deployed. Stable release remains v1.0.0; #7 and Milestone 8 remain stopped/incomplete.

## Preserved failure and root cause

The unchanged regression at `049b8a1` was rerun from an extracted snapshot against its source-matched historical images. It returned the expected **exit 1 / FAIL_ISOLATION**. The actual legacy Research consumer ran as UID/GID **1000/1000**, with `CapEff=0000000000000000`, in A's normal CWD and through the normal validator. B's scope and notes were readable, B's notes were writable, and B's valid policy was accepted. B's immutable scope correctly rejected writes. The fixture was removed after its ownership labels were verified.

The primary cause was the common Unix principal, compounded by shared Research-group access, mutually accessible workspace directories and the common mount. Roots used mode 2750; writable material belonged to the common Research identity. Tightening modes while retaining that UID would not isolate the hosts. The validator checked a caller-selected directory's consistency without binding it to the admitted Target/session. Shared native homes and tmux also needed replacement. The [original failed acceptance](research-workspace-isolation.md) remains intact.

## Implemented boundary

[Decision 0042](decisions/0042-research-workspace-isolation.md) selects dedicated UID/GID allocation and a trusted launcher broker. Allocation is durable, serialized and monotonic in a root-protected registry, within 200001–299999. Deleted and retired identities are retained; recreation receives a fresh ID. Registry loss, collisions, unsupported ID mappings, migration failures and unsafe permissions fail closed.

The broker resolves Target/session, workspace, UID/GID, provider/profile, CWD, HOME and environment from trusted state. Its Unix socket checks SO_PEERCRED and is inaccessible to console identities. Every provider, tmux server, shell and child runs with the assigned UID/GID, cleared supplementary groups, no capabilities and no-new-privileges. No Docker socket, application DB/Redis credentials, signing private key or BugHunter provider keys enter Research.

Protected root-owned workspace and provider-home ancestors prevent another identity's traversal, including when a console changes modes inside its writable home. Extended POSIX ACLs on protected roots or migration input require operator review. Expected ownership/modes are documented and tested in the [operator plan](research-isolation-operations.md).

Validators select a protected activation record using real/effective kernel credentials, then bind Target, workspace, ResearchSession and policy digest. They reject foreign paths before opening context and recheck activation after reading inputs. CWD, environment, Markdown and a structurally valid manifest confer no authority. Scope authorization remains independently enforced by ticket issuance and the bound MCP gateways.

## Actual runtime evidence

Local kernel: `Linux 7.0.0-38-generic`; Docker server: `29.9.2`. Exact Research image: `sha256:7c6bcfb488ce983878bae768d36d5f04a1e9402dd6514003b79a176f6e225772`. The fixture verifies deployed broker, console and validator source hashes before acceptance.

The final local concurrent allocation gave A UID/GID **200002/200002** and B **200001/200001**. A reported only group 200002, `CapEff=0`, `CapBnd=0`, `NoNewPrivs=1`, and CWD `/workspaces/research_m8-alice`. Allocation order may vary; persisted assignments may not. The same identities survived reconnect and disposable service restart. Recreation used 200004 and retained the old identity as retired.

| Adversarial check from A | Result |
| --- | --- |
| B scope, agent instructions, policy/session, Recon, Plan/Coverage, notes, hypotheses, evidence references | DENIED |
| B create, append, truncate, rename and delete | DENIED |
| Workspace-parent listing, B listing, sensitive B stat, sibling discovery | DENIED |
| Relative/normalized traversal, absolute path, nested/post-validation/renamed symlinks | DENIED |
| B hard link and foreign activation-record hard link | DENIED |
| B `/proc` cwd/root/fd and descriptor-based paths | DENIED; no inherited B descriptors |
| Child shell and foreign-process signalling | DENIED |
| B tmux list, attach, send-keys, capture-pane and kill-session | DENIED |
| Foreign provider index and MCP configuration | DENIED |
| A/A validator | PASS |
| A/B, B/A, stale policy, revoked activation, forged workspace/session | DENIED |

The native Codex `command/exec` path performs the kernel probe without a model turn. The real Claude launcher starts under the assigned identity; its tmux child repeats the same kernel matrix. Both run 38 denial assertions, including three immutable-own-input/root mutation controls. Additional checks verify actual ownership/modes, inability to regain UID 1000 or connect to the broker, valid own-context reads, allowed notes writes and private tmux/provider state. Known root/process/UID metadata may remain visible; sensitive descendants and process cwd/root/fd contents do not.

## Migration and lifecycle

Copied legacy fixtures preserve all workspace-file hashes, notes, scope snapshots, Recon, Plan and Coverage. Reviewed exports preserve real inference-free native Codex transcripts and a partitioned index, plus synthetic Claude project-history fixtures. Only approved native rollout paths are rewritten in the derived private Codex index; source exports remain unchanged. Repeated migration preserves newer native state. Unknown owners, links, ACLs, unreviewed histories and active legacy sessions are refused. No shared provider auth/configuration is automatically duplicated; original legacy volumes remain retained offline, and managed MCP configuration is generated privately.

Concurrent A/B migration/allocation/start/reconnect, cross-provider switching, disconnect/reconnect, restart, in-flight revocation, isolated deletion, idempotent deletion and recreation all pass. B remains active when A is revoked/deleted. Native browser acceptance additionally verifies archive preservation and deletion of live Codex/Claude consoles while preserving Target/Recon semantics.

Deployment requires coordinated Research downtime and the explicit preflight/inventory/backup/dry-run/stop/migrate/rebuild/restart/smoke sequence. Rollback restores matching workspace, registry and private-home snapshots together while admission stays stopped; it must not reopen shared-UID consoles. No production step was executed.

## Regression results

| Required gate | Result |
| --- | --- |
| Dedicated #42 suite against the exact rebuilt Research image | PASS, 38 kernel denials per provider/session |
| Full queue command with all four requested browser flags | PASS: 1,854 tests; 17 network-gated tests skipped here and passed separately |
| `npm run test:research` and its `npm run test:research:console` child | PASS |
| Native Codex/Claude profiles, browser persistence, MCP/official proxy/Playwright fixtures | PASS; no paid inference or public target traffic |
| `npm run test:network` | PASS: 17 tests / 3 files |
| `npm run test:migration` in the queue runner's empty disposable DB | PASS; historical data preserved |
| `npm run test:recon:toolchain` | PASS: actual native tools, controlled loopback fixtures |
| Lint, Next typegen, TypeScript, production build, Compose config, diff check | PASS |
| Final web CI | PASS |
| Final Research runtime isolation CI | PASS |
| Final native toolchain CI | PASS |

All three jobs passed independently on the hosted runner; its A identity was UID/GID 200001/200001 with the same zero-capability/no-new-privileges proof and 38 kernel denials. CI for the runtime revision: [run 42412493286](https://github.com/broxcat/bughunter-web/actions/runs/42412493286). Earlier fixture-host UID assumptions and intermittent truncated Claude help output were corrected before final validation. CLI installation metadata now uses bounded anonymous regular-file capture and caches only verified installation facts; authentication and authorization stay workspace-specific.

The only expected failing regression is the separately preserved vulnerable baseline. Network skips in the general suite are covered by the explicit network run. Paid inference and public target testing were intentionally not performed; optional genuine Burp acceptance was not claimed, while real native MCP/official Java proxy/local target fixtures passed.

Diagnostics WIP remains byte-for-byte preserved in stash `62c43206c62b201ceb28998fb444985dfe7de5a2` (all five original files), outside implementation commits. Its old shared-UID probe path was not restored into the trusted control service.
