#!/usr/bin/env bash
# Restart the MCP project selected by the current symlink. Deploy this file once to the application root.
set -euo pipefail

readonly SERVICE_NAME="${MCP_SERVICE_NAME:-server-login-permission-mcp.service}"
readonly APP_ROOT="${MCP_APP_ROOT:-/opt/hq-itops/server-permission-mcp}"
readonly CURRENT_LINK="${APP_ROOT}/current"
readonly HEALTH_URL="${MCP_HEALTH_URL:-http://127.0.0.1:8001/health}"

fail() {
  printf 'start-mcp: %s\n' "$*" >&2
  exit 1
}

note() {
  printf 'start-mcp: %s\n' "$*" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

current_directory() {
  [[ -L "$CURRENT_LINK" ]] || fail "current must be a symbolic link: $CURRENT_LINK"

  local app_root directory
  app_root="$(cd -- "$APP_ROOT" && pwd -P)" || fail "application root does not exist: $APP_ROOT"
  directory="$(readlink -f -- "$CURRENT_LINK")" || fail "current target cannot be resolved"
  [[ "$directory" == "${app_root}/"* ]] || fail "current target must stay under the application root"
  [[ -d "$directory" && -f "${directory}/package.json" && -f "${directory}/scripts/runtime-http.js" && -d "${directory}/src" ]] \
    || fail "current target is not a valid MCP project directory"
  node -e '
    const metadata = require(process.argv[1]);
    if (metadata.name !== "server-login-permission-application" || !/^\d+\.\d+\.\d+$/.test(metadata.version)) process.exit(1);
  ' "${directory}/package.json" || fail "current project package metadata is invalid"
  printf '%s\n' "$directory"
}

current_package_version() {
  local directory
  directory="$(current_directory)"
  node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "${directory}/package.json"
}

health_matches() {
  local expected_version="$1" response
  response="$(curl --fail --silent --show-error --max-time 3 "$HEALTH_URL")" || return 1
  HEALTH_RESPONSE="$response" EXPECTED_VERSION="$expected_version" node -e '
    const body = JSON.parse(process.env.HEALTH_RESPONSE);
    if (body.ok !== true || body.service !== "server-login-permission-application" || body.version !== process.env.EXPECTED_VERSION) process.exit(1);
  '
}

restart_current() {
  local directory expected_version attempt
  directory="$(current_directory)"
  expected_version="$(current_package_version)"
  systemctl restart "$SERVICE_NAME"
  for attempt in 1 2 3 4 5; do
    if health_matches "$expected_version"; then
      note "restarted current project $(basename -- "$directory") (package ${expected_version})"
      return 0
    fi
    sleep 1
  done
  fail "current project failed health verification; restore current to the prior directory and run restart again"
}

status() {
  local directory version
  directory="$(current_directory)"
  version="$(current_package_version)"
  printf 'current=%s\npackage_version=%s\n' "$(readlink "$CURRENT_LINK")" "$version"
}

usage() {
  cat <<'EOF'
Usage: start-mcp.sh restart
       start-mcp.sh status

The operator changes current to the desired project directory. This script only restarts systemd and verifies the selected project.
EOF
}

require_command node
require_command curl
require_command systemctl
require_command readlink

case "${1:-restart}" in
  restart) [[ $# -le 1 ]] || { usage >&2; exit 2; }; restart_current ;;
  status) [[ $# -eq 1 ]] || { usage >&2; exit 2; }; status ;;
  *) usage >&2; exit 2 ;;
esac
