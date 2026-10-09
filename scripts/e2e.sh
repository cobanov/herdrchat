#!/bin/sh
# The UI regression suite: Maestro flows against the built-in Demo host on an
# iOS simulator, every flow in dark and light. No SSH, no real host, nothing
# sent anywhere; the Demo's scenarios (src/lib/demo/scenarios.ts) stand in for
# a Claude agent.
#
#   npm run e2e                      # the booted simulator
#   E2E_DEVICE=<udid> npm run e2e    # a specific one
#   E2E_FLOWS="regression/thread" npm run e2e
#
# Needs the app installed on that simulator (a dev build with Metro running,
# or a Release build) and Maestro on PATH. Screenshots and logs go to
# $E2E_OUT (default: a dated folder under $TMPDIR); open them, a flow that
# passes can still look wrong.
set -u
cd "$(dirname "$0")/.."

DEVICE=${E2E_DEVICE:-$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=[x for r in json.load(sys.stdin)["devices"].values() for x in r if x["state"]=="Booted"]; print(d[0]["udid"] if d else "")')}
if [ -z "$DEVICE" ]; then echo "No booted simulator. Boot one, or set E2E_DEVICE." >&2; exit 2; fi
OUT=${E2E_OUT:-${TMPDIR:-/tmp}/herdrchat-e2e/$(date +%Y%m%d-%H%M%S)}
FLOWS=${E2E_FLOWS:-"regression/chat-list regression/new-chat regression/thread regression/keyboard regression/composer-keys regression/folder-trust regression/omp regression/history regression/multi-agent regression/welcome regression/host-theme regression/machines regression/menu regression/host-editor-keyboard smoke new-chat tool-activity thread-header"}
APPEARANCES=${E2E_APPEARANCES:-"Dark Light"}
mkdir -p "$OUT"

# Typed text must be what was typed: autocorrect and the prediction bar rewrite
# words after a pause, and a tap on Send landing on that rewrite is swallowed.
xcrun simctl spawn "$DEVICE" defaults write com.apple.keyboard.preferences KeyboardAutocorrection -bool false >/dev/null 2>&1
xcrun simctl spawn "$DEVICE" defaults write com.apple.keyboard.preferences KeyboardPrediction -bool false >/dev/null 2>&1

# tool-activity tests the default, so the stored choice goes first.
DB="$(xcrun simctl get_app_container "$DEVICE" dev.herdr.HerdrChat data 2>/dev/null)/Documents/SQLite/herdrchat.db"
reset_tool_setting() {
  [ -f "$DB" ] && sqlite3 "$DB" "delete from settings where key='showToolActivity'" 2>/dev/null
  return 0
}
# composer-keys turns "Return sends" off and back on; a run that failed in
# between must not leave the next one starting with it off.
reset_return_setting() {
  [ -f "$DB" ] && sqlite3 "$DB" "delete from settings where key='returnSends'" 2>/dev/null
  return 0
}

failed=""
passed=0
for appearance in $APPEARANCES; do
  for flow in $FLOWS; do
    name="$(echo "$flow" | tr '/' '-')-$appearance"
    [ "$flow" = "tool-activity" ] && { xcrun simctl terminate "$DEVICE" dev.herdr.HerdrChat >/dev/null 2>&1; reset_tool_setting; }
    [ "$flow" = "regression/composer-keys" ] && { xcrun simctl terminate "$DEVICE" dev.herdr.HerdrChat >/dev/null 2>&1; reset_return_setting; }
    printf '%-40s ' "$name"
    if maestro --device "$DEVICE" test -e APPEARANCE="$appearance" --test-output-dir "$OUT/$name" ".maestro/$flow.yaml" >"$OUT/$name.log" 2>&1; then
      echo pass
      passed=$((passed + 1))
    else
      echo FAIL
      failed="$failed $name"
    fi
  done
done

echo
echo "$passed passed. Output: $OUT"
if [ -n "$failed" ]; then
  echo "Failed:$failed"
  exit 1
fi
