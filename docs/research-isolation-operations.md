# Research isolation: operator migration plan

Status: implementation candidate; production execution is NOT authorized by this document. Release acceptance remains blocked by #42 until all required gates, including CI, pass. The original failed acceptance is retained in `research-workspace-isolation.md`.

## Boundary and requirements

Untrusted Codex, Claude, MCP, tmux and child commands execute as a dedicated UID/GID allocated from **200001–299999**. Allocation belongs to the trusted broker and is durable, serialized and monotonic. Active, deleted and retired identities remain recorded. A lost ledger with retained homes/ownership is an operator-review failure, never permission to start again at the first UID.

Read-only installation readiness uses the non-login probe identity 199999 with an empty, read-only home; it receives no Target context and is never a Research launch/acceptance identity. Actual Research launches always use allocated IDs.

The admission service remains the configured non-root `researcher` account. It does not execute console commands itself. The root broker listens only on `/run/bughunter-broker/control.sock`, mode 0600, and verifies Linux SO_PEERCRED. Its fixed operations resolve paths, homes, executable and environment internally. No Docker socket, application DB/Redis credentials, signing private key or BugHunter AI keys enter Research. Browser requests choose only existing engine/profile enums. Signed tickets travel through stdin rather than argv. Codex bootstrap contents are read from private files rather than exposed through process arguments.

Before native code starts, setpriv clears supplementary groups, drops the capability bounding/inheritable/ambient sets and enables no-new-privileges. All normal validators select root-protected identity records using real/effective kernel credentials, then verify Target, workspace, ResearchSession and policy digest. Filesystem validity, cwd and environment are insufficient authority. Shared-UID SSH command/subsystem sessions are disabled with MaxSessions 0; the existing restricted loopback reverse forwarding remains available.

Expected final permissions:

| Object | Owner/group | Mode |
| --- | --- | --- |
| Workspace parent | root | 0711; traversal without listing |
| Workspace root and immutable directories | root / workspace GID | 0750 |
| Immutable authorization/context files | root / workspace GID | 0440 |
| Mutable requests/scripts/findings directories | workspace UID/GID | 0700 |
| Mutable files | workspace UID/GID | 0600 |
| Private provider outer directory / active-record directory | root / workspace GID | 0750 |
| Private provider home, tmp and tmux runtime directories | workspace UID/GID | 0700 |
| Active identity record and publication receipt | root / workspace GID | 0440 |
| Durable identity ledger | root | 0600 |
| Broker socket | admission-service UID | 0600 |

A root-owned 0750 outer directory guards each private home, so a console cannot broaden another host’s access by chmodding its writable home. Active records live in root-owned per-UID 0750 directories at `/var/lib/bughunter-identities/active/<uid>/binding.json`, preventing foreign hard links even without a protected-hardlinks sysctl. Startup/admission rejects unsafe or world-accessible sibling roots rather than exposing them alongside an isolated A.

Root ownership of immutable roots/inputs is intentional: an untrusted owner could chmod a supposedly immutable authorization file. A workspace UID owns its allowed mutable material and provider state. Public `/proc` process/UID metadata and stat of a known workspace root may remain visible; sensitive children, process cwd/root/fd and tmux contents must be inaccessible across UIDs. This is a confidentiality/integrity boundary, not independent CPU/memory quotas for every host.

Supported runtime: Linux with pidfds, procfs descriptor traversal and util-linux setpriv; the container's trusted broker needs the explicitly listed capabilities, including SETPCAP, FOWNER and KILL. Providers receive none. Docker user namespace mappings must represent the entire allocated range. Reserve the range against host/container system accounts. Namespace creation is unnecessary. Extended POSIX access/default ACLs on protected roots or migration input are refused for operator review; chmod alone cannot erase named ACL grants. One Research broker/PID namespace owns each registry/home volume set; shared-volume Research replicas are unsupported. Insufficient mappings, collisions, invalid registry ownership or failed isolation fail closed. Never fall back to UID 1000.

## Provider state and reviewed exports

Codex and Claude use `/var/lib/bughunter-homes/<uid>/home/.codex` and `.claude`; tmp and tmux sockets live beneath that same private home. No aggregate provider home is supplied to an untrusted session. Authentication is **not shared or automatically duplicated**: each workspace can authenticate through its native provider flow. Existing aggregate provider and legacy-workspace volumes remain retained but are not mounted into the running Research service. Mount them read-only only in the offline operator migration environment; the trusted web service retains legacy archive access. Managed MCP configuration is regenerated privately; network gateway policy continues to require the bound authorization snapshot and authorized host.

A legacy shared Codex database cannot safely be copied wholesale. Migration refuses existing shared history unless an operator has approved an explicit per-workspace export. Every first migration of an unmarked legacy workspace requires a reviewed manifest, including an empty file map when the operator confirms there is no native history. The protected export is `/var/lib/bughunter-identities/exports/<Target ID>/manifest.json`, owned by root with mode 0600, inside root-protected ancestors. Its JSON contains:

```json
{
  "version": 1,
  "approvedByOperator": true,
  "targetId": "SERVER_TARGET_ID",
  "workspaceId": "research_SERVER_TARGET_ID",
  "sessionId": "SERVER_RESEARCH_SESSION_ID",
  "policySha256": "EXACT_POLICY_FILE_SHA256",
  "files": {
    ".codex/sessions/REVIEWED_NATIVE_TRANSCRIPT.jsonl": "FILE_SHA256"
  }
}
```

Place only reviewed files, matching every listed hash, beneath the export directory. Supported entries are native Codex sessions/archived sessions, a per-workspace `state_5.sqlite`, and that workspace's Claude project transcripts. Every transcript's initial cwd must agree; any SQLite thread belonging to another workspace rejects the export. Checkpoint an offline copy before exporting SQLite; WAL/global logs/config/auth files are not accepted. Preserve the original complete offline snapshot separately. Do not infer historical ownership from a mutable cwd alone: review against the trusted ResearchSession/Target history before approving. Unknown or ambiguous history is OPERATOR_REVIEW_REQUIRED, never deleted or silently assigned. No credential files are imported.

The importer holds descriptors opened without following symlinks, bounds entries/bytes, verifies hashes and copies into the allocated private home. Existing differing destination files cause review rather than overwrite. The imported Codex index rewrites only rollout paths whose exact transcripts were reviewed and copied, so native resume points into the private home. The reviewed source export remains unchanged. Once the protected binding is active, repeated migration preserves the current native state and skips reimporting the old export. A partially imported, conflicting state fails for operator review instead of overwriting newer history. Deleted runtime homes are removed only after UID-scoped process termination; approved source exports are retained separately for operator retention review.

## Production sequence — plan only

1. **Preflight:** confirm web/Research image revisions, available IDs, subordinate-ID mappings, required capabilities, disk capacity and root-protected ledger/home mounts. Stop if any prerequisite or acceptance gate is missing. No application schema migration is required.
2. **Inventory:** enumerate trusted DB ResearchSession → Target → workspace → authorization snapshot associations. Compare actual ownership/modes, record unknown roots and identify aggregate provider histories. Inventory exported UUID workspaces separately; they are retained archives and cannot use the deprecated shared-UID native launch path. Unverifiable associations require operator review.
3. **Detect active sessions:** inventory both Codex and Claude, tmux, MCP and descendant processes. Do not mutate live legacy sessions. Announce coordinated Research downtime and disable admission before proceeding.
4. **Backup:** take consistent offline snapshots of workspace data, aggregate provider volumes, private homes and identity registry together. Preserve file contents, ownership/modes, DB authorization snapshots and native SQLite/WAL state. Record checksums. Never remove Research volumes or use a blanket volume-deletion command.
5. **Prepare reviewed exports:** partition a copy of shared provider state using trusted historical associations, create the protected manifests, and retain originals. Refuse ambiguous history. Mount legacy volumes read-only in the isolated migration environment so history inventory is complete. Native auth is not copied automatically.
6. **Dry-run:** in the trusted web environment, `npx tsx scripts/research/isolationTicket.mts TARGET_ID` issues an operator-only short-lived ticket after ordinary owner/Scope/snapshot checks. Pipe its stdout directly to root's `python3 /opt/bughunter/docker/research/broker/migrate.py` in the migration environment. Do not put tickets in argv or logs. Without `--apply`, migration reports safe metadata and does not change workspace ownership/content. This operator issuer is not exposed by any browser route.
7. **Coordinated stop:** stop all legacy provider/tmux/MCP processes and descendants. Re-run active-session checks. The migration command refuses active shared-UID Research processes and active allocated identities. Do not claim zero downtime.
8. **Apply migration:** repeat issuance and pipe to the same migration command with `--apply`. It verifies trusted identity, inventories bounded regular files/directories without following links, rejects unexpected ownership/symlinks/hardlinks/devices, allocates durably, reconciles explicit descriptors, verifies preserved hashes, imports reviewed state and activates the protected binding/receipt. Repeat to demonstrate idempotence. Quarantine review failures; never delete/recreate a valuable workspace to force success.
9. **Image/service transition:** build the reviewed Research image and restart the Research service only during the approved maintenance window, preserving all named volumes. New publications carry a trusted immutable marker and are provisioned automatically after signed admission. Existing unmarked workspaces require the explicit operator migration.
10. **Smoke:** use disposable authorized A/B workspaces to verify kernel reads/writes/listing/proc/tmux denials, both native providers, validator binding, MCP, reconnect, restart and revocation/deletion isolation. Check notes/transcripts/snapshots and updated Recon/Plan/Coverage readability. Re-enable admission only after the complete gate passes.
11. **Rollback conditions:** stop admission for unexpected ownership, missing registry/home volumes, identity drift, changed file hashes, native-history incompatibility, cross-workspace access or failed cleanup. Stop allocated processes before restoring anything. Restore the matching workspace/registry/home snapshots together. Keep Research disabled rather than exposing restored shared-UID sessions. Web rollback alone cannot undo UID ownership safely.

This task does not execute any of these production steps, rebuild/restart production Research, alter production permissions, deploy web/worker or advance v1.1.0.
