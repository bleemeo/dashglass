#!/usr/bin/env bash
# End-to-end smoke test of the built Docker image: it runs the real
# non-root container and exercises the auth surface, catching packaging
# bugs the unit tests can't (e.g. a non-writable /data for the auth file).
# Usage: scripts/docker-smoke.sh [image] [port]
set -euo pipefail

IMAGE="${1:-dashglass-smoke}"
PORT="${2:-8899}"
NAME="dashglass-smoke-$$"
BASE="http://127.0.0.1:${PORT}"
COOKIES="$(mktemp)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -f "$COOKIES"
}
trap cleanup EXIT

fail() {
  echo "SMOKE FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -30 >&2 || true
  exit 1
}

# Assert an HTTP status for a request; extra curl args after the expected code.
expect_status() {
  local want="$1" got
  shift
  got=$(curl -s -o /dev/null -w "%{http_code}" "$@")
  [ "$got" = "$want" ] || fail "expected $want, got $got for: $*"
}

auth_kind() {
  curl -s "$BASE/api/capabilities" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["auth"]["kind"])'
}

echo "== starting container"
docker run -d --name "$NAME" -p "${PORT}:8080" "$IMAGE" \
  -prometheus-url http://127.0.0.1:9090 >/dev/null

echo "== waiting for the API"
for _ in $(seq 1 60); do
  curl -sf "$BASE/api/capabilities" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "$BASE/api/capabilities" >/dev/null || fail "API never came up"

echo "== auth disabled at first"
[ "$(auth_kind)" = "none" ] || fail "expected auth kind none"
expect_status 200 "$BASE/api/admin/users"

echo "== creating the first admin (writes /data/auth.yaml as non-root)"
expect_status 200 -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123","role":"admin"}' \
  "$BASE/api/admin/users"
[ "$(auth_kind)" = "builtin" ] || fail "auth did not turn on after first user"

echo "== anonymous is now rejected"
expect_status 401 "$BASE/api/dashboards"

echo "== admin logs in and can read"
expect_status 200 -c "$COOKIES" -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}' "$BASE/api/auth/login"
expect_status 200 -b "$COOKIES" "$BASE/api/dashboards"

echo "== a viewer cannot write or reach admin"
expect_status 200 -b "$COOKIES" -X POST -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123","role":"viewer"}' \
  "$BASE/api/admin/users"
VIEWER="$(mktemp)"
curl -s -c "$VIEWER" -X POST -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123"}' "$BASE/api/auth/login" >/dev/null
expect_status 403 -b "$VIEWER" -X PUT -H "Content-Type: application/yaml" \
  --data-binary $'apiVersion: v1\nkind: Dashboard\nmetadata:\n  name: x\nspec:\n  panels: {}\n  layouts: []\n' \
  "$BASE/api/dashboards/x"
expect_status 403 -b "$VIEWER" "$BASE/api/admin/users"
rm -f "$VIEWER"

echo "SMOKE OK"
