#!/usr/bin/env bash
# Run the eval suite, then ALWAYS reap the microVMs it spawned — on success,
# failure, or Ctrl+C — while preserving the eval's exit code. `eve eval` doesn't
# dispose its sandbox sessions, so without this each run leaks a Firecracker VM
# until its TTL expires.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# EXIT trap runs cleanup however the script ends (normal, error, or interrupt)
# and leaves the script's exit code intact (the trap body doesn't call exit).
cleanup() { pnpm exec tsx scripts/forgevm-clean.mts || true; }
trap cleanup EXIT

# --max-concurrency 1: concurrent eval turns collide with free-tier provider
# rate limits. Extra args (e.g. an eval id filter) pass through.
pnpm exec eve eval --max-concurrency 1 "$@"
