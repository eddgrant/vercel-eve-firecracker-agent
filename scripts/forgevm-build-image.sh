#!/usr/bin/env bash
#
# Build the pandas microVM rootfs the agent's sandbox runs on:
#   1. docker build  microvm/Dockerfile  ->  forgevm-pandas:latest  (python + pandas)
#   2. forgevm build-image               ->  cached Firecracker ext4 rootfs
#
# Run this once via `pnpm setup`, and again whenever you edit microvm/Dockerfile.
# ForgeVM caches the rootfs by image tag, so to force a clean rebuild after a
# Dockerfile change, delete the cached *.ext4 first:
#   rm -f "${FORGEVM_STATE_DIR:-$HOME/.local/share/forgevm-eve-agent}"/data/images/*.ext4
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGEVM_DIR="$ROOT/.forgevm"
IMAGE="${FORGEVM_IMAGE:-forgevm-pandas:latest}"
# Runtime state lives outside the repo (matches scripts/forgevm-serve.sh) so Eve's
# dev-runtime never snapshots a live sandbox socket. Override with FORGEVM_STATE_DIR.
STATE="${FORGEVM_STATE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/forgevm-eve-agent}"

command -v docker >/dev/null || { echo "Docker not found." >&2; exit 1; }
[[ -x "$FORGEVM_DIR/bin/forgevm" ]] || { echo "ForgeVM binary missing — run 'pnpm setup' first." >&2; exit 1; }

mkdir -p "$STATE/data"

echo "[+] docker build -> $IMAGE"
docker build -t "$IMAGE" "$ROOT/microvm"

# The path-free forgevm.yaml gets its real paths from FORGEVM_* env at launch, so
# build-image needs the same: the agent binary it injects, and the data dir it
# writes the cached rootfs into (the dir the daemon then reads from).
export FORGEVM_PROVIDERS_FIRECRACKER_AGENT_PATH="$FORGEVM_DIR/bin/forgevm-agent"
export FORGEVM_PROVIDERS_FIRECRACKER_DATA_DIR="$STATE/data"

echo "[+] forgevm build-image $IMAGE"
cd "$FORGEVM_DIR"
exec ./bin/forgevm build-image "$IMAGE"
