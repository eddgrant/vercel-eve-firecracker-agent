#!/usr/bin/env bash
#
# Stop the ForgeVM daemon started by `pnpm forgevm:serve`.
#
# `forgevm serve` runs in the foreground and writes no pidfile, and the CLI has no
# daemon-stop subcommand (`forgevm kill` destroys a SANDBOX, not the server). So we
# first reap any live microVMs (so Firecracker VMs don't linger until their TTL),
# then signal the daemon process.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Reap sandboxes while the daemon is still reachable (no-ops if already down).
pnpm exec tsx scripts/forgevm-clean.mts || true

# Signal the daemon. We match the running process's cmdline ('./bin/forgevm serve').
# This is self-match-safe: this script's own cmdline is 'bash scripts/forgevm-stop.sh',
# which doesn't contain the pattern, so pkill can't target itself.
if pkill -f 'bin/forgevm serve'; then
  echo "forgevm:stop — daemon stopped"
else
  echo "forgevm:stop — daemon not running"
fi

# The daemon doesn't always tear down its microVMs on exit, and any the reaper
# above missed (or that the daemon was no longer tracking) outlive it as
# independent processes — once the daemon is gone, forgevm:clean can't reach them.
# Kill this project's leftover Firecracker VMs directly, matched by the in-tree
# binary path so microVMs from other projects are never touched.
if pkill -f "$ROOT/.forgevm/bin/firecracker"; then
  echo "forgevm:stop — killed leftover Firecracker microVM(s)"
fi

# Stopping an already-stopped daemon is not an error.
exit 0
