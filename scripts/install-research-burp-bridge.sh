#!/bin/bash
set -euo pipefail
port="${RESEARCH_SSH_PORT:-2222}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( port > 0 && port <= 65535 )) || { echo 'Invalid RESEARCH_SSH_PORT' >&2; exit 1; }
unit="$HOME/.config/systemd/user/bughunter-research-burp-bridge.service"
config=$(cat <<UNIT
[Unit]
Description=BugHunter local Burp Proxy and MCP reverse SSH bridge
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -NT -i %h/.ssh/bughunter_research -p $port -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -R 127.0.0.1:8080:127.0.0.1:8080 -R 127.0.0.1:9876:127.0.0.1:9876 researcher@127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
)
printf '%s\n' "$config"
if [[ "${1:-}" != --install ]]; then
  printf '\nPreview only. Use --install to confirm installation of %s\n' "$unit"
  exit 0
fi
[[ -f "$HOME/.ssh/bughunter_research" ]] || { echo 'Prepare your own SSH key and verify the runner host fingerprint first.' >&2; exit 1; }
printf '\nInstall/replace this user service and enable it now at %s? [y/N] ' "$unit"
read -r answer
[[ "$answer" == y || "$answer" == Y ]] || { echo 'No service installed.'; exit 0; }
umask 077
mkdir -p "$(dirname "$unit")"
[[ ! -L "$unit" ]] || { echo 'Refusing a symlink service file' >&2; exit 1; }
printf '%s\n' "$config" > "$unit"
systemctl --user daemon-reload
systemctl --user enable --now bughunter-research-burp-bridge.service
