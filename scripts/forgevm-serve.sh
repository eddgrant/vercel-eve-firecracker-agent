#!/usr/bin/env bash
#
# Launch the ForgeVM daemon with machine-independent paths.
#
# Why this script exists: ForgeVM's forgevm.yaml has no ${VAR} interpolation, and
# absolute paths in it would not be portable across a dev team. ForgeVM (viper)
# lets every config key be overridden by a FORGEVM_* env var (prefix FORGEVM,
# dots -> underscores), and env vars win over the YAML. So we keep forgevm.yaml
# path-free and derive the real paths here at launch time:
#
#   - the in-tree binaries/kernel are resolved from the repo root ($ROOT)
#   - runtime state (data dir + sqlite db) lives OUTSIDE the repo so Eve's
#     dev-runtime never snapshots a live sandbox socket (which breaks `cp`).
#     Override its location with FORGEVM_STATE_DIR.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGEVM_DIR="$ROOT/.forgevm"
STATE="${FORGEVM_STATE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/forgevm-eve-agent}"

mkdir -p "$STATE/data"

# In-tree, machine-specific binaries (bootstrapped into .forgevm/ per machine).
export FORGEVM_PROVIDERS_FIRECRACKER_FIRECRACKER_PATH="$FORGEVM_DIR/bin/firecracker"
export FORGEVM_PROVIDERS_FIRECRACKER_KERNEL_PATH="$FORGEVM_DIR/vmlinux.bin"
export FORGEVM_PROVIDERS_FIRECRACKER_AGENT_PATH="$FORGEVM_DIR/bin/forgevm-agent"

# Out-of-tree runtime state (kept clear of Eve's project-dir snapshot).
export FORGEVM_PROVIDERS_FIRECRACKER_DATA_DIR="$STATE/data"
export FORGEVM_DATABASE_PATH="$STATE/forgevm.db"

# cd into .forgevm so the path-free forgevm.yaml is discovered (viper looks in cwd).
cd "$FORGEVM_DIR"
exec ./bin/forgevm serve
