#!/usr/bin/env python3
"""Check the effective Compose ingress boundary without printing credentials.

No containers are started. Run from the repository root; requires Docker Compose.
"""
import json
import os
from pathlib import Path
import subprocess


def require(condition, message):
    if not condition:
        raise SystemExit("FAIL: " + message)


# Resolve a non-secret sentinel, never the locally configured auth key. This
# checks that only the sidecar receives the provisioning variable without
# reading the real credential from Compose's resolved configuration.
credential_sentinel = "bughunter-config-validation-not-a-credential"
result = subprocess.run(
    ["docker", "compose", "--profile", "tailscale", "config", "--format", "json"],
    capture_output=True, text=True,
    env={**os.environ, "TAILSCALE_BUGHUNTER_AUTHKEY": credential_sentinel},
)
require(result.returncode == 0, "Compose resolution failed; run docker compose config --quiet")
config = json.loads(result.stdout)
services = config["services"]
sidecar = services["tailscale-bughunter"]
require(set(sidecar["networks"]) == {"tailscale_frontend"}, "sidecar network boundary")
require(set(services["web"]["networks"]) == {"default", "tailscale_frontend"}, "web networks")
require(services["web"]["networks"]["default"]["gw_priority"] == 1, "preserve web egress")
for name, service in services.items():
    if name not in {"web", "tailscale-bughunter"}:
        require("tailscale_frontend" not in service.get("networks", {}), "internal service on frontend: " + name)
    require(service.get("network_mode") != "service:tailscale-bughunter", "shared sidecar namespace: " + name)
    if name != "tailscale-bughunter":
        env = service.get("environment", {})
        require(not env.get("TAILSCALE_BUGHUNTER_AUTHKEY"), "provisioning credential leaks to " + name)

require(not services["web"].get("ports"), "web must not publish host ports")
require(services["web"].get("expose") == ["3000"], "web internal port")
require(sidecar["environment"].get("TS_HOSTNAME") == "bughunter-web", "dedicated hostname")
require("TS_ENABLE_HEALTH_CHECK" not in sidecar["environment"], "HTTP health listener must remain disabled")
require("TS_ENABLE_METRICS" not in sidecar["environment"], "HTTP metrics listener must remain disabled")
require(not sidecar.get("ports"), "sidecar publishes a host port")
require(not sidecar.get("privileged"), "privileged sidecar")
require(not sidecar.get("devices") and not sidecar.get("cap_add"), "unneeded TUN/capabilities")
require(sidecar.get("cap_drop") == ["ALL"], "capabilities must be dropped")
require("no-new-privileges:true" in sidecar.get("security_opt", []), "privilege escalation")
env = sidecar["environment"]
require(env.get("TS_AUTHKEY") == credential_sentinel, "dedicated auth key interpolation")
for name, value in {
    "TS_STATE_DIR": "/var/lib/tailscale", "TS_AUTH_ONCE": "true",
    "TS_USERSPACE": "true", "TS_ACCEPT_DNS": "false",
    "TS_SERVE_CONFIG": "/etc/bughunter-tailscale/serve.json",
    "TS_EXTRA_ARGS": "--advertise-tags=tag:bughunter --accept-routes=false",
}.items():
    require(env.get(name) == value, "unexpected " + name)
require(set(env) == {
    "TS_AUTHKEY", "TS_HOSTNAME", "TS_STATE_DIR", "TS_AUTH_ONCE", "TS_USERSPACE",
    "TS_ACCEPT_DNS", "TS_SERVE_CONFIG",
    "TS_EXTRA_ARGS",
}, "unexpected proxy/routing environment")
mounts = sidecar["volumes"]
require(len(mounts) == 2, "unexpected sidecar mount")
state = next((v for v in mounts if v["target"] == "/var/lib/tailscale"), {})
require(state.get("type") == "volume" and state.get("source") == "tailscale-bughunter-state", "dedicated state")
serve_mount = next((v for v in mounts if v["target"] == "/etc/bughunter-tailscale"), {})
require(serve_mount.get("read_only") and serve_mount.get("type") == "bind", "read-only config directory")
require(Path(serve_mount.get("source", "")).resolve() == Path("docker/tailscale").resolve(), "unexpected config path")
require(":v1.104.2@sha256:" in sidecar["image"], "image must be pinned")
require(json.loads(Path("docker/tailscale/serve.json").read_text()) == {
    "TCP": {"443": {"HTTPS": True}},
    "Web": {"${TS_CERT_DOMAIN}:443": {"Handlers": {"/": {"Proxy": "http://web:3000"}}}},
    "AllowFunnel": {},
}, "Serve must expose only HTTPS → web:3000, without Funnel")
print("PASS: effective Compose isolation, secret scope, pinned image and Serve configuration")
print("Runtime segmentation, HTTPS, state persistence and login still require the enrolled node.")
