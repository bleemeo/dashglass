#!/usr/bin/env bash
# Regenerate the demo screenshots end to end: boot a deterministic fake
# Prometheus and the current backend, then capture the demo dashboard in
# light + dark into ./out/.
#
# Prerequisite: the SPA dev server must already be running and serving BASE
# (it also proxies /api to the backend):
#
#     pnpm --filter dashglass dev        # http://localhost:3000
#
# Then:
#
#     scripts/screenshots/run.sh
#
# Env: BASE (default http://localhost:3000), PROM_PORT (9091),
# BACKEND_PORT (8080), CHROME (macOS Google Chrome path), SCHEMES.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
PROM_PORT="${PROM_PORT:-9091}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
BASE="${BASE:-http://localhost:3000}"
export BASE

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v go >/dev/null || { echo "go is required" >&2; exit 1; }

if ! curl -sf -o /dev/null "$BASE"; then
  echo "SPA not reachable at $BASE." >&2
  echo "Start it first:  pnpm --filter dashglass dev" >&2
  exit 1
fi

kill_port() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill 2>/dev/null || true
}

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done
  # `go run` spawns a temporary binary that outlives its parent, so also
  # release the ports we bound.
  kill_port "$PROM_PORT"
  kill_port "$BACKEND_PORT"
}
trap cleanup EXIT

echo "→ fake Prometheus on :$PROM_PORT"
node fake-prometheus.mjs "$PROM_PORT" &
pids+=($!)

echo "→ backend on :$BACKEND_PORT (go run, anonymous-admin)"
(
  cd "$ROOT/backend" && exec go run . \
    -listen "127.0.0.1:$BACKEND_PORT" \
    -prometheus-url "http://127.0.0.1:$PROM_PORT" \
    -dashboards-dir "$ROOT/scripts/screenshots/dashboards"
) &
pids+=($!)

printf "→ waiting for the backend API"
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:$BACKEND_PORT/api/capabilities"; then
    echo " ok"
    break
  fi
  printf "."
  sleep 1
done

echo "→ capturing"
node capture.mjs

echo "done — PNGs in $(pwd)/out/"
