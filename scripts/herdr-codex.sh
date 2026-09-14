#!/usr/bin/env bash
# herdrchat-managed-codex-launcher-v1
# Start Codex with this Herdr pane's context, including with a shared app server.
# Does not replace `codex`, change global settings, or bypass hook trust.
set -euo pipefail

if [[ "${HERDR_ENV:-}" != 1 || -z "${HERDR_PANE_ID:-}" || -z "${HERDR_SOCKET_PATH:-}" ]]; then
  echo 'Run herdrchat-codex inside the Herdr pane that should own this chat.' >&2
  exit 1
fi

command -v python3 >/dev/null || { echo 'python3 is required by the Herdr integration.' >&2; exit 1; }
command -v codex >/dev/null || { echo 'Codex is not on PATH in this pane.' >&2; exit 1; }

# JSON strings are valid TOML strings. Quote paths as values, never as shell code.
quote_env() {
  python3 -c 'import json, os, sys; print(json.dumps(os.environ[sys.argv[1]]))' "$1"
}

exec codex \
  -c 'features.hooks=true' \
  -c 'shell_environment_policy.set.HERDR_ENV="1"' \
  -c "shell_environment_policy.set.HERDR_PANE_ID=$(quote_env HERDR_PANE_ID)" \
  -c "shell_environment_policy.set.HERDR_SOCKET_PATH=$(quote_env HERDR_SOCKET_PATH)" \
  "$@"
