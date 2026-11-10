# Issue 42: retained baseline regression

> **Retired.** The Research console (Codex/Claude terminals, Burp bridge and their containers) has been removed from BugHunter. Research is now done manually in a local CLI. This page is kept for history only; see [Research console removal](research-console-removal.md).

Status: OPEN. Milestone 8 remains BLOCKED BY #42. This change preserves the failing gate; it does not implement isolation or authorize release acceptance.

Base: 9b3aa25080b0bcdb47137d448444fb890e64b5fb. Run `node tests/research/workspaceIsolationBaseline.mjs` from the repository root. Requires existing disposable fixture images `bughunter-m7-web:local` and `bughunter-m7-research:local`. The script checks publication and validator helper source hashes against this checkout before interpreting results. Image-defined `researcher` must resolve to UID/GID 1000/1000. Root only publishes fixtures; acceptance runs as researcher with zero capabilities, network disabled and read-only container root. No production mounts or sessions are used. Only nonce-labelled fixture resources are removed.

Observed on 2026-11-07: exit 1, FAIL_ISOLATION. Own scope read and policy validation succeeded. Foreign scope read, notes read, notes append and normal `openConsoleWorkspace(B)` all succeeded. Foreign immutable scope write failed. Fixture cleanup succeeded. This is a deliberately failing secure acceptance gate, not a passing vulnerability assertion.

## Root cause

- `console-entrypoint` drops the Node terminal service to the common `researcher:research` identity using `setpriv --init-groups`. Tmux and both provider launchers inherit that identity. Distinct tmux names and cwd provide no filesystem separation.
- Docker bind mounts the entire host root at `/workspaces` into the single common console container. The legacy volume is also visible at `/legacy-workspaces`. A cwd is not a mount boundary.
- Publication uses the common configured UID/GID. READY roots are 2750; immutable inputs are group-readable 0440. Mutable directories use 2770 and files 0660, with the common researcher owning mutable content. The shared group permits immutable reads; shared identity/group permits mutable writes. `/workspaces` initialization uses 3770: sticky/setgid controls do not prevent traversal into readable foreign roots.
- `openConsoleWorkspace(cwd)` enforces canonical path shape, no-follow descriptor traversal, policy/scope integrity and internal Target/workspace agreement. It accepts another complete valid workspace because it has no trusted caller Target/session binding. Internal manifest consistency is insufficient authority.
- The shared legacy supplementary group and shared provider state also require examination in any replacement. The common same-UID service/tmux processes are part of the attack surface, beyond directory permissions.

## Required architecture work (not implemented)

Evaluate a privileged broker outside untrusted console identities, with dedicated per-workspace runtime identities and kernel-enforced file/process separation, or one container per workspace mounting only its own root. Do not expose a Docker socket to Research. A shared-UID chmod adjustment cannot satisfy this threat model. A namespace-only solution must also prevent foreign process descriptor/root access and shared tmux/provider-state access.

Trusted admission must resolve ticket/session, Target, workspace and authorization snapshot server-side and carry that binding through launch and validation. Caller-controlled paths or environment variables alone cannot supply authority. Preserve independent server Scope/network authorization.

Existing sessions cannot acquire a new kernel boundary in place. An explicit bounded reconciliation must inventory ownership, links, publication identity and snapshots, refuse unexpected content, preserve notes/transcripts, and provide an operator-controlled transition. Do not recursively chown arbitrary existing trees or silently reassign a workspace. No migration has been implemented or run.

## Outstanding gate

Implement architecture, validator binding, migration and full two-host adversarial matrix including both providers, MCP and lifecycle transitions. Independently validate as actual runtime identities, then run the requested full suite. None of those acceptance results is claimed by this baseline test. Issue 7 remains open. Stable release remains v1.0.0.
