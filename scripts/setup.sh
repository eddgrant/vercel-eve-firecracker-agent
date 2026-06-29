#!/usr/bin/env bash
#
# One-time bootstrap for the local ForgeVM + Firecracker stack this agent runs on.
#
# A fresh clone has no microVM runtime. The Firecracker binary, the guest kernel,
# the ForgeVM daemon + in-guest agent, and the pandas rootfs all live under the
# (gitignored) .forgevm/ directory, because they're large and machine-specific.
# This script fetches/builds them so `pnpm forgevm:serve` and `pnpm dev` can run.
#
# It is idempotent: anything already present (with a matching checksum) is
# skipped, so it's safe to re-run.
#
# Install these yourself first (this script does NOT install system software):
#   - Linux on x86_64, with KVM enabled (/dev/kvm present)
#   - Docker, running, with your user in the `docker` group
#   - curl and tar
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGEVM_DIR="$ROOT/.forgevm"
BIN="$FORGEVM_DIR/bin"
DL="$FORGEVM_DIR/dl"

# Pinned versions (match what this repo was developed against).
FORGEVM_VERSION="v0.1.2"
FIRECRACKER_VERSION="v1.16.0"
KERNEL_URL="https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/x86_64/kernels/vmlinux.bin"

# Known-good SHA256s from the ForgeVM v0.1.2 release checksums.txt.
FORGEVM_SHA="86d345fdca3d5c846b531c2b5c4270619b79d0fc85cb912079bd69fd69ed3468"
FORGEVM_AGENT_SHA="26221e71893c6a006c5760ffd04471b8df121914d4e6f628acd44f4fdcdeb952"

info() { printf '\033[0;32m[+]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
[[ "$(uname -s)" == "Linux"  ]] || fail "Firecracker needs Linux (you're on $(uname -s))."
[[ "$(uname -m)" == "x86_64" ]] || fail "This setup targets x86_64 (you're on $(uname -m))."
[[ -e /dev/kvm ]] || fail "/dev/kvm not found. KVM is required for Firecracker microVMs."
[[ -r /dev/kvm && -w /dev/kvm ]] || \
  warn "/dev/kvm isn't read/write for you. Try: sudo usermod -aG kvm \$(whoami) && newgrp kvm"
command -v curl   >/dev/null || fail "curl not found."
command -v tar    >/dev/null || fail "tar not found."
command -v docker >/dev/null || fail "Docker not found. Install it and make sure it's running."
docker info >/dev/null 2>&1   || fail "Docker isn't running, or you're not in the docker group."

mkdir -p "$BIN" "$DL"

verify_sha() { echo "$2  $1" | sha256sum -c --status 2>/dev/null; }  # <file> <sha>

# ── ForgeVM daemon + in-guest agent (prebuilt release binaries; no Go needed) ─
fetch_forgevm() {  # <asset> <dest> <sha>
  local asset="$1" dest="$2" sha="$3"
  if [[ -f "$dest" ]] && verify_sha "$dest" "$sha"; then
    info "$(basename "$dest") already present, skipping."
    return
  fi
  info "Downloading $asset ($FORGEVM_VERSION)..."
  curl -fsSL -o "$dest" \
    "https://github.com/DohaerisAI/forgevm/releases/download/$FORGEVM_VERSION/$asset"
  verify_sha "$dest" "$sha" || fail "$asset failed checksum verification."
  chmod +x "$dest"
}
fetch_forgevm "forgevm-linux-amd64"       "$BIN/forgevm"       "$FORGEVM_SHA"
fetch_forgevm "forgevm-agent-linux-amd64" "$BIN/forgevm-agent" "$FORGEVM_AGENT_SHA"

# ── Firecracker ──────────────────────────────────────────────────────────────
if [[ -x "$BIN/firecracker" ]]; then
  info "firecracker already present, skipping."
else
  info "Downloading Firecracker $FIRECRACKER_VERSION..."
  curl -fsSL -o "$DL/firecracker.tgz" \
    "https://github.com/firecracker-microvm/firecracker/releases/download/$FIRECRACKER_VERSION/firecracker-$FIRECRACKER_VERSION-x86_64.tgz"
  tar -xzf "$DL/firecracker.tgz" -C "$DL"
  cp "$DL/release-$FIRECRACKER_VERSION-x86_64/firecracker-$FIRECRACKER_VERSION-x86_64" "$BIN/firecracker"
  chmod +x "$BIN/firecracker"
fi

# ── Guest kernel ─────────────────────────────────────────────────────────────
if [[ -f "$FORGEVM_DIR/vmlinux.bin" ]]; then
  info "Guest kernel already present, skipping."
else
  info "Downloading the Firecracker guest kernel (vmlinux.bin)..."
  curl -fsSL -o "$FORGEVM_DIR/vmlinux.bin" "$KERNEL_URL"
fi

# ── Pandas rootfs (Docker image -> Firecracker ext4 rootfs) ──────────────────
info "Building the pandas microVM rootfs..."
bash "$ROOT/scripts/forgevm-build-image.sh"

info "Bootstrap complete."
echo
echo "Next steps:"
echo "  1. pnpm ollama:up && pnpm ollama:pull && pnpm ollama:model   # local model"
echo "  2. cp .env.example .env   # then uncomment OLLAMA_MODEL=data-analyst"
echo "  3. pnpm forgevm:serve     # in one terminal (starts the microVM daemon)"
echo "  4. pnpm dev               # in another (opens the Eve chat TUI)"
