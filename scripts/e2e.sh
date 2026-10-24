#!/bin/sh
# The UI regression suite: Maestro flows against the built-in Demo host on iOS
# simulators. No SSH, no real host, nothing sent anywhere; the Demo's scenarios
# (src/lib/demo/scenarios.ts) stand in for a Claude agent.
#
#   npm run e2e                      # every flow, split over two simulators
#   npm run e2e -- changed           # only the flows what you changed can break
#   E2E_FLOWS="regression/thread" npm run e2e
#   E2E_APPEARANCES="Dark Light" npm run e2e   # every flow in both themes
#   E2E_PARALLEL=1 npm run e2e       # one simulator
#   E2E_DEVICES="<udid> <udid>" npm run e2e
#   E2E_DRY_RUN=1 npm run e2e -- changed   # list the runs, run nothing
#
# Most flows run once, in Dark: they check behaviour, which the theme does not
# change. The screens a person looks at most (BOTH_THEMES) run in Light too.
# Running every flow twice on one simulator took over an hour.
#
# Needs the app installed on the booted simulator (a dev build with Metro
# running, or a Release build) and Maestro on PATH. The second simulator is
# made from the first ("HerdrChat E2E 2", same model and iOS) and gets the same
# app copied onto it. Screenshots and logs go to $E2E_OUT (default: a dated
# folder under $TMPDIR); open them, a flow that passes can still look wrong.
set -u
cd "$(dirname "$0")/.."

ALL_FLOWS="regression/chat-list regression/new-chat regression/thread regression/keyboard regression/composer-keys regression/folder-trust regression/omp regression/grok regression/agy regression/history regression/multi-agent regression/welcome regression/subagents regression/slash-commands regression/shell-commands regression/terminal regression/space-layout regression/menu regression/tabs regression/list-modes regression/host-editor-keyboard regression/host-theme regression/headsup regression/notifications smoke new-chat tool-activity thread-header"
BOTH_THEMES="smoke regression/chat-list regression/thread regression/tabs regression/terminal"
THREAD_FLOWS="regression/thread regression/keyboard regression/composer-keys regression/history regression/subagents regression/slash-commands regression/shell-commands regression/omp regression/grok regression/agy tool-activity thread-header"

# The flows a changed file can break. Shared code (components, theme, state,
# the Demo, src/lib, native iOS code, dependencies) can break any screen, so it
# runs them all; tests, docs, the relay and Android-only code run none.
flows_for() {
  case "$1" in
    .maestro/regression/_*) echo "$ALL_FLOWS" ;;
    .maestro/regression/*.yaml) echo "regression/$(basename "$1" .yaml)" ;;
    .maestro/*.yaml) basename "$1" .yaml ;;
    *__tests__/*|*.test.ts|*.test.tsx|*.md|relay/*|site/*|modules/*/android/*) ;;
    src/features/thread/*|src/lib/thread*|src/lib/composer*|app/chat/*) echo "$THREAD_FLOWS regression/headsup" ;;
    src/features/chats/*|"app/(tabs)/index.tsx") echo "regression/chat-list regression/list-modes regression/menu regression/multi-agent regression/headsup" ;;
    src/features/headsup/*|app/headsup.tsx) echo "regression/headsup" ;;
    src/features/newChat/*|app/new-chat.tsx|app/folder-picker.tsx) echo "regression/new-chat regression/folder-trust new-chat" ;;
    src/features/terminal/*|src/lib/terminal/*|modules/herdr-terminal/*|modules/herdr-shell-registry/*) echo "regression/terminal regression/tabs" ;;
    src/features/files/*|src/features/devices/*|src/lib/files/*|"app/(tabs)/"*) echo "regression/tabs" ;;
    src/features/settings/*|src/features/notifications/*|app/settings.tsx) echo "regression/notifications regression/host-theme regression/menu" ;;
    src/features/spaces/*|src/lib/spaces/*|app/space-layout.tsx) echo "regression/space-layout" ;;
    src/features/servers/*|app/server/*|app/hosts.tsx) echo "regression/host-editor-keyboard" ;;
    src/features/welcome/*|app/welcome.tsx) echo "regression/welcome" ;;
    modules/herdr-keys/*) echo "regression/composer-keys regression/keyboard" ;;
    src/*|app/*|modules/*|package.json|package-lock.json|app.json) echo "$ALL_FLOWS" ;;
  esac
}

changed_flows() {
  wanted="smoke"
  for file in $( (git diff --name-only HEAD; git ls-files --others --exclude-standard) | sort -u); do
    wanted="$wanted $(flows_for "$file")"
  done
  # In the suite's own order, each once.
  for flow in $ALL_FLOWS; do
    case " $wanted " in *" $flow "*) printf '%s ' "$flow" ;; esac
  done
}

if [ "${1:-}" = "changed" ]; then
  FLOWS=$(changed_flows)
  echo "Changed: $FLOWS"
else
  FLOWS=${E2E_FLOWS:-$ALL_FLOWS}
fi

RUNS=""
for flow in $FLOWS; do
  if [ -n "${E2E_APPEARANCES:-}" ]; then
    appearances=$E2E_APPEARANCES
  else
    case " $BOTH_THEMES " in *" $flow "*) appearances="Dark Light" ;; *) appearances="Dark" ;; esac
  fi
  for appearance in $appearances; do RUNS="$RUNS $flow:$appearance"; done
done

# E2E_DRY_RUN=1: say what would run, and run nothing.
if [ -n "${E2E_DRY_RUN:-}" ]; then echo "$RUNS" | tr ' ' '\n' | sed '/^$/d'; exit 0; fi

# Leaves out the second simulator: booted from a previous run, it would be
# picked as it is, still holding the app it was last given.
booted() {
  xcrun simctl list devices booted -j | python3 -c 'import json,sys; [print(x["udid"]) for r in json.load(sys.stdin)["devices"].values() for x in r if x["state"]=="Booted" and x["name"]!="HerdrChat E2E 2"]'
}

# A second simulator like the first, made once and kept, with the first's app
# copied onto it on every run (a rebuilt app must not leave it testing the old one).
helper_device() {
  source_udid=$1
  udid=$(xcrun simctl list devices -j | python3 -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for d in devices:
        if d["name"] == "HerdrChat E2E 2" and d.get("isAvailable", True):
            print(d["udid"]); sys.exit()')
  if [ -z "$udid" ]; then
    spec=$(xcrun simctl list devices -j | python3 -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for d in devices:
        if d["udid"] == sys.argv[1]:
            print(d["deviceTypeIdentifier"], runtime); sys.exit()' "$source_udid")
    # shellcheck disable=SC2086 # two words on purpose: device type, runtime
    udid=$(xcrun simctl create "HerdrChat E2E 2" $spec) || return 1
  fi
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || return 1
  app=$(xcrun simctl get_app_container "$source_udid" dev.herdr.HerdrChat 2>/dev/null) || return 1
  xcrun simctl install "$udid" "$app" || return 1
  # The first's settings, which hold the Metro a dev build opens at launch: this
  # one has never opened any. Opening the dev URL instead stops on iOS's
  # "Open in HerdrChat?" prompt, which nothing answers.
  # Copied as the file: `simctl spawn defaults` reaches another domain than the app's.
  xcrun simctl terminate "$udid" dev.herdr.HerdrChat >/dev/null 2>&1
  from=$(xcrun simctl get_app_container "$source_udid" dev.herdr.HerdrChat data)/Library/Preferences
  to=$(xcrun simctl get_app_container "$udid" dev.herdr.HerdrChat data)/Library/Preferences
  mkdir -p "$to" && cp "$from/dev.herdr.HerdrChat.plist" "$to/" 2>/dev/null
  echo "$udid"
}

PARALLEL=${E2E_PARALLEL:-2}
DEVICES=${E2E_DEVICES:-${E2E_DEVICE:-$(booted | head -n "$PARALLEL" | tr '\n' ' ')}}
first=$(echo "$DEVICES" | awk '{print $1}')
if [ -z "$first" ]; then echo "No booted simulator. Boot one, or set E2E_DEVICES." >&2; exit 2; fi
if [ -z "${E2E_DEVICES:-}${E2E_DEVICE:-}" ] && [ "$(echo "$DEVICES" | wc -w)" -lt "$PARALLEL" ] && [ "$(echo "$RUNS" | wc -w)" -gt 1 ]; then
  if helper=$(helper_device "$first"); then
    DEVICES="$DEVICES $helper"
  else
    echo "Couldn't set up a second simulator; running on one." >&2
  fi
fi

OUT=${E2E_OUT:-${TMPDIR:-/tmp}/herdrchat-e2e/$(date +%Y%m%d-%H%M%S)}
mkdir -p "$OUT"

setup_device() {
  device=$1
  # Typed text must be what was typed: autocorrect and the prediction bar rewrite
  # words after a pause, and a tap on Send landing on that rewrite is swallowed.
  xcrun simctl spawn "$device" defaults write com.apple.keyboard.preferences KeyboardAutocorrection -bool false >/dev/null 2>&1
  xcrun simctl spawn "$device" defaults write com.apple.keyboard.preferences KeyboardPrediction -bool false >/dev/null 2>&1
  # Reduce Motion stills the Demo's working spinners (the app honours it). A
  # spinner never settles, so every tap and waitForAnimationToEnd ran to its
  # timeout: four to six minutes a flow instead of about one.
  xcrun simctl spawn "$device" defaults write com.apple.Accessibility ReduceMotionEnabled -bool true >/dev/null 2>&1
  # A development build has Expo's developer menu, which a Release build has none
  # of: it opened over the app at launch, and its floating button sat on the
  # Chats menu and took the tap. Every flow failed in its first step.
  for key in EXDevMenuShowsAtLaunch EXDevMenuShowFloatingActionButton EXDevMenuTouchGestureEnabled; do
    xcrun simctl spawn "$device" defaults write dev.herdr.HerdrChat "$key" -bool false >/dev/null 2>&1
  done
  xcrun simctl spawn "$device" defaults write dev.herdr.HerdrChat EXDevMenuIsOnboardingFinished -bool true >/dev/null 2>&1
}

# Settings a flow changes and puts back, cleared before it in case an earlier
# run failed in between:
#   showToolActivity  tool-activity tests the default
#   returnSends       composer-keys turns it off and on
#   listMode          list-modes switches to Agents (cleared after it too, so a
#                     failure does not leave every later flow on Agents)
#   chat_prefs        chat-list pins and mutes a Demo chat
reset_for() {
  db=$1
  [ -f "$db" ] || return 0
  case "$2" in
    tool-activity) sqlite3 "$db" "delete from settings where key='showToolActivity'" ;;
    regression/composer-keys) sqlite3 "$db" "delete from settings where key='returnSends'" ;;
    regression/list-modes) sqlite3 "$db" "delete from settings where key='listMode'" ;;
    regression/chat-list) sqlite3 "$db" "delete from chat_prefs where connection_id='demo'" ;;
  esac 2>/dev/null
  return 0
}

# One run, killed after E2E_TIMEOUT seconds (default 480; a flow takes one to
# three minutes). Maestro once hung for good after an error of its own, and the
# suite sat waiting on it. perl's alarm carries over exec: macOS has no timeout(1).
run_flow() {
  [ -f "$OUT/$3.log" ] && mv "$OUT/$3.log" "$OUT/$3.first.log"
  perl -e 'alarm shift; exec @ARGV' "${E2E_TIMEOUT:-480}" \
    maestro --device "$1" test -e APPEARANCE="$2" --test-output-dir "$OUT/$3" ".maestro/$4.yaml" >"$OUT/$3.log" 2>&1
}

# One simulator's share: every Nth run, in order.
worker() {
  device=$1 index=$2 count=$3
  db="$(xcrun simctl get_app_container "$device" dev.herdr.HerdrChat data 2>/dev/null)/Documents/SQLite/herdrchat.db"
  i=0
  for run in $RUNS; do
    i=$((i + 1))
    [ $(((i - 1) % count)) -eq "$index" ] || continue
    flow=${run%:*}
    appearance=${run##*:}
    name="$(echo "$flow" | tr '/' '-')-$appearance"
    case "$flow" in
      tool-activity|regression/composer-keys|regression/list-modes|regression/chat-list)
        xcrun simctl terminate "$device" dev.herdr.HerdrChat >/dev/null 2>&1
        reset_for "$db" "$flow" ;;
    esac
    # A failure is tried once more and reported as such: Maestro's iOS driver
    # sometimes loses the view hierarchy ("Request for viewHierarchy failed")
    # with nothing wrong in the app.
    if run_flow "$device" "$appearance" "$name" "$flow"; then
      result=pass
    elif run_flow "$device" "$appearance" "$name" "$flow"; then
      result="pass (on retry; see $name.first.log)"
    else
      result=FAIL
    fi
    printf '%-40s %s\n' "$name" "$result"
    echo "${result%% *} $name" >>"$OUT/.results"
    if [ "$flow" = "regression/list-modes" ]; then
      xcrun simctl terminate "$device" dev.herdr.HerdrChat >/dev/null 2>&1
      reset_for "$db" "$flow"
    fi
  done
}

count=$(echo "$DEVICES" | wc -w | tr -d ' ')
echo "$(echo "$RUNS" | wc -w | tr -d ' ') runs on $count simulator(s)."
: >"$OUT/.results"
index=0
for device in $DEVICES; do
  setup_device "$device"
  worker "$device" "$index" "$count" &
  index=$((index + 1))
done
wait

echo
passed=$(grep -c '^pass' "$OUT/.results")
echo "$passed passed. Output: $OUT"
failed=$(grep '^FAIL ' "$OUT/.results" | cut -d' ' -f2 | tr '\n' ' ')
if [ -n "$failed" ]; then
  echo "Failed: $failed"
  exit 1
fi
