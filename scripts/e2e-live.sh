#!/bin/sh
# The live counterpart of `npm run e2e`: the app against this Mac as a real
# host, for what the Demo cannot show (HC-128). Five bugs the live test of
# 2026-10-16 found were all of that kind.
#
#   npm run e2e:live                          # every agent whose herdr integration is current
#   LIVE_AGENTS="claude grok" npm run e2e:live
#   LIVE_PICTURE=1 npm run e2e:live           # also send each probe a picture
#
# It makes a key and a host key in a temporary folder and starts its own sshd
# on 127.0.0.1 that accepts that key only; `~/.ssh` and Remote Login are not
# touched. Then it adds the host in the app (.maestro/add-server.yaml) and,
# for each agent, starts a probe chat from New chat in a scratch folder, sends
# one message and waits for the reply (.maestro/live/probe.yaml). On a pass or
# a failure it closes the workspaces in the scratch folders, deletes the probe
# sessions Claude, Grok and agy filed for them, removes the host from the app,
# stops the sshd and deletes the folder. It sends prompts only to the chats it
# started. Left behind: Claude's trust of each scratch folder in ~/.claude.json,
# which every running Claude rewrites, and agy's summary database, which agy
# holds open; both name folders that no longer exist.
#
# Needs the app on a booted simulator, built signed ad hoc: an unsigned build
# has no keychain, and saving the host fails.
#   xcodebuild ... CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO
# LIVE_PICTURE is off by default: `simctl addmedia` hangs on some simulators.
# Maestro's logs hold the run's key; it is useless once the sshd stops, but
# keep $E2E_OUT out of the repository all the same.
set -u
cd "$(dirname "$0")/.."

DEVICE=${E2E_DEVICE:-$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=[x for r in json.load(sys.stdin)["devices"].values() for x in r if x["state"]=="Booted"]; print(d[0]["udid"] if d else "")')}
if [ -z "$DEVICE" ]; then echo "No booted simulator. Boot one, or set E2E_DEVICE." >&2; exit 2; fi
HERDR=${HERDR:-$(command -v herdr || echo "$HOME/.local/bin/herdr")}
if [ ! -x "$HERDR" ]; then echo "herdr not found. Set HERDR to its path." >&2; exit 2; fi
PORT=${LIVE_PORT:-22264}
if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then echo "Port $PORT is in use. Set LIVE_PORT." >&2; exit 2; fi
OUT=${E2E_OUT:-${TMPDIR:-/tmp}/herdrchat-live/$(date +%Y%m%d-%H%M%S)}
mkdir -p "$OUT"
WORK=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/herdrchat-live.XXXXXX")" && pwd -P)
SCRATCH="$WORK/chats"
mkdir -p "$SCRATCH"
NAME="live-$(date +%H%M%S)"
APP_DB="$(xcrun simctl get_app_container "$DEVICE" dev.herdr.HerdrChat data 2>/dev/null)/Documents/SQLite/herdrchat.db"
# The host this run saved in the app, by its name: empty until it is saved.
host_id() { sqlite3 "$APP_DB" "select id from connections where name = '$NAME'" 2>/dev/null; }

# Each agent New chat can start: herdr's kind, its integration, its label there.
agent_info() {
  case "$1" in
    claude) echo "claude Claude Code" ;;
    codex) echo "codex Codex" ;;
    grok) echo "grok Grok" ;;
    agy) echo "antigravity-cli Antigravity" ;;
    pi) echo "pi Pi" ;;
    omp) echo "omp OMP" ;;
    *) return 1 ;;
  esac
}

if [ -z "${LIVE_AGENTS:-}" ]; then
  current=$("$HERDR" integration status 2>/dev/null | sed -n 's/^\([a-z-]*\): current.*/\1/p')
  LIVE_AGENTS=""
  for kind in claude codex grok agy pi omp; do
    integration=$(agent_info "$kind" | cut -d' ' -f1)
    echo "$current" | grep -qx "$integration" && LIVE_AGENTS="$LIVE_AGENTS $kind"
  done
fi
if [ -z "$(echo "$LIVE_AGENTS" | tr -d ' ')" ]; then echo "No agent with a current herdr integration. Set LIVE_AGENTS." >&2; exit 2; fi

run() {
  name=$1; shift
  printf '%-32s ' "$name"
  if maestro --device "$DEVICE" test --test-output-dir "$OUT/$name" "$@" >"$OUT/$name.log" 2>&1; then
    echo pass
  else
    echo FAIL
    return 1
  fi
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  # The probe chats' workspaces, each one with a pane in the scratch folder,
  # and the conversation ids agy reported in them, read before they close.
  probes=$("$HERDR" api snapshot 2>/dev/null | python3 -I -c '
import json, re, sys
root = sys.argv[1] + "/"
panes = [p for p in json.load(sys.stdin)["result"]["snapshot"]["panes"] if (p.get("cwd") or "").startswith(root)]
for workspace in sorted({p["workspace_id"] for p in panes}):
    print("workspace", workspace)
for p in panes:
    value = (p.get("agent_session") or {}).get("value") or ""
    uuid = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    found = re.fullmatch(uuid, value) or re.search(rf"/brain/({uuid})/", value)
    if p.get("agent") == "agy" and found:
        print("agy", found.group(found.lastindex or 0))
' "$SCRATCH")
  echo "$probes" | while read -r kind id; do
    [ "$kind" = workspace ] && "$HERDR" workspace close "$id" >/dev/null 2>&1 && echo "closed workspace $id"
  done
  # agy files a conversation by its id, and each prompt and trusted folder by path.
  agy_home="$HOME/.gemini/antigravity-cli"
  echo "$probes" | while read -r kind id; do
    [ "$kind" = agy ] || continue
    rm -rf "${agy_home:?}/brain/${id:?}" "${agy_home:?}/conversations/${id:?}.db" && echo "removed agy conversation $id"
  done
  python3 -I - "$SCRATCH" "$agy_home" <<'PY'
import json, os, sys
root, home = sys.argv[1] + "/", sys.argv[2]
def replace(path, text):
    with open(path + ".herdrchat-live", "w") as out:
        out.write(text)
    os.replace(path + ".herdrchat-live", path)
history = os.path.join(home, "history.jsonl")
if os.path.exists(history):
    lines = open(history).readlines()
    def ours(line):
        try:
            return (json.loads(line).get("workspace") or "").startswith(root)
        except (ValueError, AttributeError):
            return False
    kept = [line for line in lines if not ours(line)]
    if len(kept) != len(lines):
        replace(history, "".join(kept))
        print("removed", len(lines) - len(kept), "agy history lines")
settings = os.path.join(home, "settings.json")
if os.path.exists(settings):
    data = json.load(open(settings))
    trusted = data.get("trustedWorkspaces") or []
    kept = [path for path in trusted if not path.startswith(root)]
    if len(kept) != len(trusted):
        data["trustedWorkspaces"] = kept
        replace(settings, json.dumps(data, indent=2) + "\n")
        print("removed", len(trusted) - len(kept), "agy trusted folders")
PY
  # The agents' own records of the probe chats, filed by the scratch folder's
  # path: Claude's with / and . as -, Grok's URL-encoded.
  claude_dir=$(printf '%s' "$SCRATCH" | sed 's|[/.]|-|g')
  grok_dir=$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SCRATCH")
  for dir in "$HOME/.claude/projects/$claude_dir"-* "${GROK_HOME:-$HOME/.grok}/sessions/$grok_dir"%2F*; do
    [ -d "$dir" ] && rm -rf "$dir" && echo "removed $dir"
  done
  id=$(host_id)
  if [ -n "$id" ]; then
    run remove-host -e ID="$id" .maestro/live/remove-host.yaml || status=1
    [ -n "$(host_id)" ] && { echo "The app still has the host $NAME."; status=1; }
  fi
  [ -f "$WORK/sshd.pid" ] && kill "$(cat "$WORK/sshd.pid")" 2>/dev/null
  rm -rf "${WORK:?}"
  echo "Output: $OUT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

ssh-keygen -q -t ed25519 -N '' -C herdrchat-live -f "$WORK/client"
ssh-keygen -q -t ed25519 -N '' -C herdrchat-live-host -f "$WORK/host_key"
printf 'from="127.0.0.1",no-agent-forwarding,no-port-forwarding,no-X11-forwarding %s\n' "$(cat "$WORK/client.pub")" >"$WORK/authorized_keys"
cat >"$WORK/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $WORK/host_key
AuthorizedKeysFile $WORK/authorized_keys
PidFile $WORK/sshd.pid
UsePAM no
StrictModes no
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers $(id -un)
EOF
/usr/sbin/sshd -D -e -f "$WORK/sshd_config" 2>"$OUT/sshd.log" &
tries=0
until nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt 50 ]; then echo "sshd did not start; see $OUT/sshd.log" >&2; exit 1; fi
  sleep 0.1
done

run add-host -e HOST=127.0.0.1 -e PORT="$PORT" -e NAME="$NAME" -e USERNAME="$(id -un)" \
  -e HERDR_PATH="$HERDR" -e SSH_KEY="$(cat "$WORK/client")" .maestro/add-server.yaml || exit 1

PICTURE=${LIVE_PICTURE:-0}
[ "$PICTURE" = 1 ] && xcrun simctl addmedia "$DEVICE" docs/screenshots/chats-dark.png

failed=""
for kind in $LIVE_AGENTS; do
  label=$(agent_info "$kind" | cut -d' ' -f2-) || { echo "Unknown agent: $kind" >&2; failed="$failed $kind"; continue; }
  mkdir -p "$SCRATCH/$kind"
  run "probe-$kind" -e CWD="$SCRATCH/$kind" -e LABEL="probe-$kind" -e AGENT="$label" -e PICTURE="$PICTURE" \
    .maestro/live/probe.yaml || failed="$failed $kind"
done

if [ -n "$failed" ]; then echo "Failed:$failed"; exit 1; fi
