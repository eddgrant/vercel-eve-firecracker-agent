#!/usr/bin/env bash
#
# Stop a backgrounded / orphaned `eve dev` server (the one recorded in
# .eve/dev-server.json, listening on :2000).
#
# An interactive TUI session normally exits with `/exit` or Ctrl+C — you don't need
# this script for that. It's for the headless/leftover case: a dev server still
# holding the port so `pnpm eval` refuses to start ("a dev server is already
# running (pid X)").
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

f=".eve/dev-server.json"
if [ ! -f "$f" ]; then
  echo "dev:stop — no $f; nothing to stop"
  exit 0
fi

# Extract the recorded pid via node (no jq dependency).
pid="$(node -e "try { process.stdout.write(String(JSON.parse(require('fs').readFileSync('$f','utf8')).pid ?? '')) } catch {}")"

if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  kill "$pid" && echo "dev:stop — stopped eve dev (pid $pid)"
else
  echo "dev:stop — recorded pid not running"
fi

exit 0
