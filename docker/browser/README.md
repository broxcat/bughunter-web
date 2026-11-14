# Isolated browser runtime

This image contains only Playwright/Chromium and its Unix-socket broker.
Run with the restrictions in `docker-compose.yml`; a TCP-reachable or locally
launched browser is not a supported substitute. Chromium's sandbox is mandatory.

`seccomp.json` comes from the [Playwright 1.64.1 Docker profile](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json).
The first allow rule additionally permits `chroot`, needed by Chromium's
namespace sandbox after creating its user namespace. This grants no container
capability; `cap_drop: ALL` and `no-new-privileges` remain enabled. The Linux
acceptance runner checks the actual namespace/seccomp sandbox and network
separation. A sandbox launch failure fails explicitly without retrying unsandboxed.

The socket volume contains no application data. Only the application clients
and this broker share it. Each session has a private socket, a bounded lifetime
and a process group killed before the broker acknowledges termination. Never
mount application source, secrets, data directories or the Docker socket here.
