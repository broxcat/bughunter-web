# Research console removal

BugHunter no longer runs Research consoles. Research is done manually, in a CLI
on the operator's machine:

**Targets → Recon → manual Research (local CLI) → Findings → Report.**

## What changed

- The `research-console`, `research-terminal-proxy` and `burp` services, their
  images, volumes and networks are gone from `docker-compose.yml`.
- `web` and `worker` no longer receive `RESEARCH_*` variables, Research mounts or
  the terminal signing key.
- The console pages, the terminal/launcher/Burp/harness APIs and the Burp
  enrichment Recon step are removed. Recon skips that step with an explicit reason.
- `POST /api/research-sessions` returns **410 Gone**.
- HTTP request/response evidence and retests no longer need a Research session.
  The observed URL and the Finding location must stay inside the current Target
  scope.

## What stays

- No destructive migration. Research sessions, hypotheses, coverage, plans and
  evidence stay in the database and remain readable at `/research` and
  `/research/history/<sessionId>`.
- The CLI inputs: `/api/programs/<id>/scope.md` and
  `/api/programs/<id>/campaign/handoff`, linked from the Target's Research page.

## Operator steps (after the release is merged)

Run these on the Docker host that runs BugHunter, from the repository directory.
Replace `<project>` with the Compose project name shown by `docker compose ls`
(usually the directory name).

### 1. List what will be removed

```sh
docker compose ls
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -Ei 'research|burp'
docker image ls | grep -Ei 'bughunter-(research|burp)'
docker volume ls | grep -Ei 'research|burp'
docker network ls | grep -Ei 'research|burp'
grep -E '^(RESEARCH|BURP)_' .env
ls -ld "$RESEARCH_HOST_ROOT" data/research-terminal data/research-ssh data/research 2>/dev/null
```

`RESEARCH_HOST_ROOT` comes from `.env`; load it first with
`export $(grep -E '^RESEARCH_HOST_ROOT=' .env)` if it is not already set.

Review the list before you continue.

### 2. Back up (optional, recommended)

The workspaces may hold notes and captures you want to keep.

```sh
backup="research-backup-$(date +%Y%m%d)"
mkdir -p "$backup"
tar -C "$(dirname "$RESEARCH_HOST_ROOT")" -czf "$backup/host-root.tgz" "$(basename "$RESEARCH_HOST_ROOT")"
docker run --rm -v <project>_research-workspaces:/data:ro -v "$PWD/$backup":/backup alpine \
  tar -C /data -czf /backup/research-workspaces.tgz .
```

### 3. Apply the new stack

```sh
git pull
docker compose up -d --build --remove-orphans
```

`--remove-orphans` stops and removes `research-console`,
`research-terminal-proxy` and `burp`.

### 4. Remove images, volumes and networks

```sh
docker image rm bughunter-research bughunter-research-terminal-proxy bughunter-burp
docker volume rm <project>_research-workspaces <project>_research-codex \
  <project>_research-claude <project>_research-host-keys <project>_research-identities \
  <project>_research-private-homes <project>_burp-home
docker network rm <project>_research_terminal <project>_burp_link <project>_research_egress
```

A missing image, volume or network only produces an error for that item; the
others are still removed.

### 5. Remove host data and variables

```sh
rm -rf -- "$RESEARCH_HOST_ROOT" data/research-terminal data/research-ssh data/research
sed -i.bak -E '/^(RESEARCH|BURP)_/d' .env
```

Check `.env` against `.env.example`, then delete `.env.bak`.

### 6. Verify

None of these should list anything related to Research or Burp:

```sh
docker ps -a | grep -Ei 'research|burp'
docker image ls | grep -Ei 'research|burp'
docker volume ls | grep -Ei 'research|burp'
docker network ls | grep -Ei 'research|burp'
```

Then open `/research` and an old `/research/history/<sessionId>` page to confirm
that the history is still readable.
