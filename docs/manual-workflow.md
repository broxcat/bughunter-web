# Manual workflow and console retirement

The Target dashboard remains `/targets/[id]`. Its cards lead to Target settings,
Recon history, manual Research and Findings. Research has no startup side effects.
Pause remains useful while Recon is queued/running; it is hidden during manual work.
Opening Research does not transition into scheduled monitoring.

Scope stays an execution boundary. Discoveries are observations. Adding selected
hosts is an explicit authenticated, same-origin action; it validates membership in
the run and rechecks current exclusions under the Target lock. Existing scope and
execution policy enforcement remain in place; no new policy system is introduced.

## Docker upgrade

Removed services: `research-console`, `research-terminal-proxy`.
Removed volume declarations: `research-codex`, `research-claude`, `research-host-keys`,
`research-identities`, `research-private-homes`. Removed network: `research_terminal`.
Removed terminal key mounts and Research SSH/7681 exposure. The optional standalone
Burp service and its persistent home remain independent.

Keep database and Redis volumes. Keep `research-workspaces` for historical ZIPs.
Set `RESEARCH_ARCHIVE_HOST_ROOT` to the old Research host directory if it contains
historical per-host evidence; web mounts it at `/research-archives`. Local npm runs
can set `RESEARCH_ARCHIVE_ROOT` to the same directory. No migration is needed.
Do not delete old volumes or bind directories: this change removes declarations,
not stored data. Back up transcripts/private homes before deciding their retention.

Stop the retired services before starting the new version:

```sh
docker compose stop research-console research-terminal-proxy # using the old compose file
docker compose build web worker
docker compose up -d
```

Do not use `down -v` or volume pruning. An old local Compose override must remove
terminal key mounts and map the archive path instead. Existing running deployments
are not modified by source changes alone. The local override in this workspace has
been adapted; it is operator configuration and is not distributed in the PR.

## History and routes

`ResearchSession`, hypotheses/revisions, promotions, coverage, Recon snapshots,
Findings and evidence remain in the database. Historical ZIPs and hypothesis files
remain readable; there is no automatic provisioning or native-process attachment.
`/research/[id]` redirects to a historical session or manual Research.
`/scopes` redirects to Targets or Target settings; `/scopes/[id]` resolves the owned
asset under `/targets/[id]/assets/[assetId]`. Scope authorization APIs remain.
Terminal, launcher, console-control and Recon-to-console delivery APIs are removed.
Manual findings use the existing per-host Finding form linked from Research.
