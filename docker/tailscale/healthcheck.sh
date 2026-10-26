#!/bin/sh
set -eu

# CLI uses the local Unix socket; no HTTP health listener is exposed.
status=$(tailscale status --json --peers=false)
printf '%s' "$status" | grep -Eq '"BackendState"[[:space:]]*:[[:space:]]*"Running"'
printf '%s' "$status" | grep -Eq '"Online"[[:space:]]*:[[:space:]]*true'
serve=$(tailscale serve status --json)
printf '%s' "$serve" | grep -Eq '"HTTPS"[[:space:]]*:[[:space:]]*true'
printf '%s' "$serve" | grep -Eq '"Proxy"[[:space:]]*:[[:space:]]*"http://web:3000"'
# Readiness of the intended application, including its DB/Redis dependencies.
# This does not replace a real client-side HTTPS/login test.
wget -q -T 5 -O /dev/null http://web:3000/api/health
